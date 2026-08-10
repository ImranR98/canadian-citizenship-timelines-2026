require("dotenv").config();

const { scrape } = require("./scrape");
const { prompt } = require("./llm");
const fs = require("fs");
const path = require("path");

const URL = "https://www.reddit.com/r/ImmigrationCanada/comments/1q6vm0e/megathread_processing_times_citizenship_2026/";
const COOKIE = process.env.REDDIT_COOKIE;
const LLM_BASE_URL = process.env.LLM_BASE_URL;
const LLM_MODEL = process.env.LLM_MODEL;
const LLM_API_KEY = process.env.LLM_API_KEY;
const CONCURRENCY = parseInt(process.env.LLM_CONCURRENCY, 10) || 5;
const TEST_MODE = process.env.LLM_TEST_MODE === "1" || process.env.LLM_TEST_MODE === "true";
const TEST_SAMPLE_SIZE = 5;

const DATA_DIR = "data";
const NOT_APPLICABLE_FILE = path.join(DATA_DIR, "not_applicable.json");
const INVALID_FILE = path.join(DATA_DIR, "invalid.json");
const RAW_OUTPUT = "comments_raw.json";
const MAX_RETRIES = 3;

const DATE_FIELDS = [
  "application_date", "aor_date", "background_check_date",
  "test_invitation_date", "test_taken_date", "test_completed_date",
  "lpp_date", "oath_scheduled_date", "oath_ceremony_date"
];

function formatThread(node, depth) {
  depth = depth || 0;
  const indent = "  ".repeat(depth);
  let text = `${indent}[id: ${node.id}] ${node.body}\n`;
  for (const reply of node.replies) {
    text += formatThread(reply, depth + 1);
  }
  return text;
}

function buildPrompt(threadText) {
  return `Extract the citizenship application timeline from the following Reddit comment thread.
Return ONLY valid JSON (no markdown, no code fences, no explanation).

Fields (all dates in YYYY-MM-DD format, use null if unknown):
{
  "application_date": "YYYY-MM-DD or null",
  "aor_date": "YYYY-MM-DD or null",
  "background_check_date": "YYYY-MM-DD or null",
  "test_invitation_date": "YYYY-MM-DD or null",
  "test_taken_date": "YYYY-MM-DD or null",
  "test_completed_date": "YYYY-MM-DD or null",
  "lpp_date": "YYYY-MM-DD or null",
  "oath_scheduled_date": "YYYY-MM-DD or null",
  "oath_ceremony_date": "YYYY-MM-DD or null",
  "application_type": "string or null",
  "location": "string or null",
  "processing_office": "string or null",
  "notes": "string",
  "extra_steps": [{"step": "string", "date": "YYYY-MM-DD"}]
}

If this comment thread does NOT contain a citizenship application timeline/progress report
(e.g. it's just a question, off-topic discussion, congratulations, or general chat), return exactly:
null

Comment thread:
${threadText}`;
}

function buildRetryPrompt(originalPrompt, errors) {
  return `Your previous response was invalid. Errors:\n${errors.join(";\n")}\n\nPlease fix these issues and return ONLY the corrected JSON:\n\n${originalPrompt}`;
}

function validate(extracted) {
  const errors = [];

  if (typeof extracted !== "object" || extracted === null || Array.isArray(extracted)) {
    errors.push("Response must be a JSON object");
    return { valid: false, errors };
  }

  const epochDates = {};
  for (const field of DATE_FIELDS) {
    const val = extracted[field];
    if (val === null || val === undefined) {
      epochDates[field] = null;
      continue;
    }
    if (typeof val !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      errors.push(`${field} must be YYYY-MM-DD or null, got: ${JSON.stringify(val)}`);
      continue;
    }
    const parsed = new Date(val + "T00:00:00Z");
    if (isNaN(parsed.getTime())) {
      errors.push(`${field} is not a valid date: ${val}`);
      continue;
    }
    epochDates[field] = parsed.getTime();
  }

  let prevDate = null;
  let prevField = null;
  for (const field of DATE_FIELDS) {
    const current = epochDates[field];
    if (current === null) continue;
    if (prevDate !== null && current < prevDate) {
      errors.push(`${field} (${extracted[field]}) is before ${prevField} (${extracted[prevField]})`);
    }
    prevDate = current;
    prevField = field;
  }

  if (extracted.extra_steps !== undefined) {
    if (!Array.isArray(extracted.extra_steps)) {
      errors.push("extra_steps must be an array");
    } else {
      for (let i = 0; i < extracted.extra_steps.length; i++) {
        const step = extracted.extra_steps[i];
        if (!step.step || typeof step.step !== "string") {
          errors.push(`extra_steps[${i}].step must be a string`);
        }
        if (step.date && (typeof step.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(step.date))) {
          errors.push(`extra_steps[${i}].date must be YYYY-MM-DD, got: ${JSON.stringify(step.date)}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function loadIdList(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (_) {}
  return [];
}

function saveIdList(filePath, ids) {
  fs.writeFileSync(filePath, JSON.stringify(ids, null, 2));
}

function alreadyProcessed(id) {
  return fs.existsSync(path.join(DATA_DIR, `${id}.json`));
}

async function processComment(comment, baseUrl, model, apiKey) {
  const id = comment.id;
  const threadText = formatThread(comment);
  const originalPrompt = buildPrompt(threadText);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const promptText = attempt === 0
      ? originalPrompt
      : buildRetryPrompt(originalPrompt, lastErrors);

    let response;
    try {
      response = await prompt(promptText, baseUrl, model, apiKey);
    } catch (err) {
      console.error(`  [${id}] LLM error (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${err.message}`);
      if (attempt === MAX_RETRIES) {
        return { id, status: "failed", reason: `LLM error after ${MAX_RETRIES + 1} attempts: ${err.message}` };
      }
      continue;
    }

    let cleaned = response.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```\s*$/, "").trim();
    }

    if (cleaned === "null") {
      return { id, status: "null" };
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      lastErrors = ["Response is not valid JSON"];
      if (attempt === MAX_RETRIES) {
        return { id, status: "invalid", reason: "JSON parse failed after all retries" };
      }
      continue;
    }

    const result = validate(parsed);
    if (result.valid) {
      fs.writeFileSync(path.join(DATA_DIR, `${id}.json`), JSON.stringify(parsed, null, 2));
      return { id, status: "processed" };
    }

    lastErrors = result.errors;
    if (attempt === MAX_RETRIES) {
      return { id, status: "invalid", reason: result.errors.join("; ") };
    }
  }
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
      const result = await processComment(comment, LLM_BASE_URL, LLM_MODEL, LLM_API_KEY);

      switch (result.status) {
        case "processed":
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
