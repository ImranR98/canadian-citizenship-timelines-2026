require("dotenv").config();

const { scrape } = require("./scrape");
const { extractTimeline } = require("./prompt");
const fs = require("fs");
const path = require("path");

const URL = "https://www.reddit.com/r/ImmigrationCanada/comments/1q6vm0e/megathread_processing_times_citizenship_2026/";
const COOKIE = process.env.REDDIT_COOKIE;
const LLM_BASE_URL = process.env.LLM_BASE_URL;
const LLM_MODEL = process.env.LLM_MODEL;
const LLM_API_KEY = process.env.LLM_API_KEY;
const CONCURRENCY = parseInt(process.env.LLM_CONCURRENCY, 10) || 1;
const TEST_MODE = process.env.LLM_TEST_MODE === "1" || process.env.LLM_TEST_MODE === "true";
const TEST_SAMPLE_SIZE = 5;

const DATA_DIR = "data";
const NOT_APPLICABLE_FILE = path.join(DATA_DIR, "not_applicable.json");
const INVALID_FILE = path.join(DATA_DIR, "invalid.json");
const RAW_OUTPUT = "comments_raw.json";

function loadIdList(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (_) {}
  return [];
}

function saveIdList(filePath, ids) {
  fs.writeFileSync(filePath, JSON.stringify(ids, null, 2));
}

function alreadyProcessed(id) {
  return fs.existsSync(path.join(DATA_DIR, `${id}.json`));
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  console.log("Scraping Reddit comments...");
  const tree = await scrape(URL, COOKIE);
  console.log(`Scraped ${tree.length} top-level comments`);

  fs.writeFileSync(RAW_OUTPUT, JSON.stringify(tree, null, 2));
  console.log(`Saved raw dump to ${RAW_OUTPUT}`);

  const notApplicable = new Set(loadIdList(NOT_APPLICABLE_FILE));
  const invalid = new Set(loadIdList(INVALID_FILE));

  let pending = tree.filter(c => {
    if (alreadyProcessed(c.id)) return false;
    if (notApplicable.has(c.id)) return false;
    if (invalid.has(c.id)) return false;
    return true;
  });

  if (TEST_MODE && pending.length > TEST_SAMPLE_SIZE) {
    for (let i = pending.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }
    pending = pending.slice(0, TEST_SAMPLE_SIZE);
  }

  const skipped = tree.length - pending.length;
  if (skipped > 0) {
    console.log(`Skipping ${skipped} already-processed/known comments`);
  }
  if (TEST_MODE) {
    console.log(`TEST MODE: processing ${pending.length} random sample comment(s)\n`);
  } else {
    console.log(`Processing ${pending.length} new comments (concurrency: ${CONCURRENCY})\n`);
  }

  let index = 0;
  let processed = 0;
  let nullCount = 0;
  let invalidCount = 0;
  let failedCount = 0;

  async function worker() {
    while (index < pending.length) {
      const i = index++;
      const comment = pending[i];
      const result = await extractTimeline(comment, LLM_BASE_URL, LLM_MODEL, LLM_API_KEY);

      switch (result.status) {
        case "processed":
          fs.writeFileSync(path.join(DATA_DIR, `${result.id}.json`), JSON.stringify(result.parsed, null, 2));
          processed++;
          console.log(`[${result.id}] processed`);
          break;
        case "null": {
          nullCount++;
          const ids = loadIdList(NOT_APPLICABLE_FILE);
          if (!ids.includes(result.id)) {
            ids.push(result.id);
            saveIdList(NOT_APPLICABLE_FILE, ids);
          }
          console.log(`[${result.id}] skipped (not a timeline)`);
          break;
        }
        case "invalid":
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
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
