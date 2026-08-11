"use strict";

const { scrape } = require("./fetch");
const { extractTimeline, hashThread } = require("./reddit");
const fs = require("fs");
const path = require("path");

const URL = "https://www.reddit.com/r/ImmigrationCanada/comments/1q6vm0e/megathread_processing_times_citizenship_2026/";
const DATA_DIR = "data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const RAW_OUTPUT = path.join(DATA_DIR, "comments_raw.json");
const TEST_SAMPLE_SIZE = 5;

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch (e) {
    console.debug("Failed to load state:", e.message);
  }
  return {};
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function run() {
  const COOKIE = process.env.REDDIT_COOKIE;
  const LLM_BASE_URL = process.env.LLM_BASE_URL;
  const LLM_MODEL = process.env.LLM_MODEL;
  const LLM_API_KEY = process.env.LLM_API_KEY;
  const CONCURRENCY = parseInt(process.env.LLM_CONCURRENCY, 10) || 20;
  const TEST_MODE = process.env.LLM_TEST_MODE === "1" || process.env.LLM_TEST_MODE === "true";

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const state = loadState();

  console.log("Scraping Reddit comments...");
  const tree = await scrape(URL, COOKIE);
  console.log(`Scraped ${tree.length} top-level comments`);

  fs.writeFileSync(RAW_OUTPUT, JSON.stringify(tree, null, 2));
  console.log(`Saved raw dump to ${RAW_OUTPUT}`);

  let pending = [];
  let skipped = 0;
  for (const comment of tree) {
    const hash = hashThread(comment);
    const entry = state[comment.id];
    if (entry && entry.hash === hash) {
      skipped++;
    } else {
      pending.push({ comment, hash });
    }
  }

  if (TEST_MODE && pending.length > TEST_SAMPLE_SIZE) {
    for (let i = pending.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }
    pending = pending.slice(0, TEST_SAMPLE_SIZE);
  }

  if (skipped > 0) {
    console.log(`Skipping ${skipped} unchanged comments`);
  }
  if (TEST_MODE) {
    console.log(`TEST MODE: processing ${pending.length} random sample comment(s)\n`);
  } else {
    console.log(`Processing ${pending.length} new/changed comments (concurrency: ${CONCURRENCY})\n`);
  }

  let index = 0;
  let processed = 0;
  let nullCount = 0;
  let invalidCount = 0;
  let failedCount = 0;

  async function worker() {
    while (index < pending.length) {
      const i = index++;
      const { comment, hash } = pending[i];
      const result = await extractTimeline(comment, LLM_BASE_URL, LLM_MODEL, LLM_API_KEY);

      switch (result.status) {
        case "processed":
          state[result.id] = { status: "processed", hash };
          const output = Object.assign({}, result.parsed, { source: comment });
          const safeId = /^[a-z0-9]+$/i.test(result.id) ? result.id : "unknown";
          fs.writeFileSync(path.join(DATA_DIR, `${safeId}.json`), JSON.stringify(output, null, 2));
          saveState(state);
          processed++;
          console.log(`[${result.id}] processed`);
          break;
        case "null":
          state[result.id] = { status: "not_applicable", hash };
          saveState(state);
          nullCount++;
          console.log(`[${result.id}] skipped (not a timeline)`);
          break;
        case "invalid":
          state[result.id] = { status: "invalid", hash };
          saveState(state);
          invalidCount++;
          console.warn(`[${result.id}] INVALID after retries: ${result.reason}`);
          break;
        case "failed":
          failedCount++;
          console.error(`[${result.id}] FAILED: ${result.reason}`);
          break;
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, pending.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  console.log(`\nDone! ${processed} processed, ${nullCount} not applicable, ${invalidCount} invalid, ${failedCount} failed`);

  return {
    scraped: tree.length,
    skipped,
    processed,
    nullCount,
    invalidCount,
    failedCount,
  };
}

module.exports = { run };

if (require.main === module) {
  require("dotenv").config();
  for (const method of ["log", "warn", "error"]) {
    const orig = console[method];
    console[method] = (...args) => {
      const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
      orig(`[${ts}]`, ...args);
    };
  }
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
