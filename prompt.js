const { prompt: callLLM } = require("./llm");
const { scrape } = require("./scrape");
const fs = require("fs");

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

function findInTree(tree, id) {
  for (const node of tree) {
    if (node.id === id) return node;
    const found = findInTree(node.replies, id);
    if (found) return found;
  }
  return null;
}

async function extractTimeline(commentNode, baseUrl, model, apiKey) {
  const id = commentNode.id;
  const threadText = formatThread(commentNode);
  const originalPrompt = buildPrompt(threadText);
  const attempts = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const promptText = attempt === 0
      ? originalPrompt
      : buildRetryPrompt(originalPrompt, lastErrors);

    const t0 = Date.now();
    let response;
    try {
      response = await callLLM(promptText, baseUrl, model, apiKey);
    } catch (err) {
      const ms = Date.now() - t0;
      attempts.push({ attempt, error: err.message, ms });
      if (attempt === MAX_RETRIES) {
        return { id, status: "failed", reason: `LLM error after ${MAX_RETRIES + 1} attempts: ${err.message}`, attempts };
      }
      continue;
    }
    const ms = Date.now() - t0;

    let cleaned = response.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```\s*$/, "").trim();
    }

    if (cleaned === "null") {
      attempts.push({ attempt, response: "null", ms });
      return { id, status: "null", attempts };
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      lastErrors = ["Response is not valid JSON"];
      attempts.push({ attempt, response: cleaned.slice(0, 200), error: "JSON parse failed", ms });
      if (attempt === MAX_RETRIES) {
        return { id, status: "invalid", reason: "JSON parse failed after all retries", errors: lastErrors, attempts };
      }
      continue;
    }

    const result = validate(parsed);
    if (result.valid) {
      attempts.push({ attempt, parsed, ms });
      return { id, status: "processed", parsed, attempts };
    }

    lastErrors = result.errors;
    attempts.push({ attempt, parsed, errors: result.errors, ms });
    if (attempt === MAX_RETRIES) {
      return { id, status: "invalid", reason: result.errors.join("; "), errors: result.errors, attempts };
    }
  }
}

if (require.main === module) {
  require("dotenv").config();

  const targetId = process.argv[2];
  if (!targetId) {
    console.error("Usage: node prompt.js <comment_id>");
    process.exit(1);
  }

  const RAW_OUTPUT = "comments_raw.json";
  const URL = "https://www.reddit.com/r/ImmigrationCanada/comments/1q6vm0e/megathread_processing_times_citizenship_2026/";
  const COOKIE = process.env.REDDIT_COOKIE;
  const LLM_BASE_URL = process.env.LLM_BASE_URL;
  const LLM_MODEL = process.env.LLM_MODEL;
  const LLM_API_KEY = process.env.LLM_API_KEY;

  async function run() {
    let tree;
    if (fs.existsSync(RAW_OUTPUT)) {
      console.log(`Loading from ${RAW_OUTPUT}...`);
      tree = JSON.parse(fs.readFileSync(RAW_OUTPUT, "utf-8"));
      console.log(`Loaded ${tree.length} top-level comments\n`);
    } else {
      console.log("Scraping fresh...");
      const t0 = Date.now();
      tree = await scrape(URL, COOKIE);
      console.log(`Scraped ${tree.length} comments in ${Date.now() - t0}ms`);
      fs.writeFileSync(RAW_OUTPUT, JSON.stringify(tree, null, 2));
    }

    const comment = findInTree(tree, targetId);
    if (!comment) {
      console.error(`Comment ${targetId} not found in thread tree`);
      process.exit(1);
    }

    const threadText = formatThread(comment);
    console.log(`Comment: ${comment.id}`);
    console.log(`Reply count: ${comment.replies.length}`);
    console.log(`Thread text: ${threadText.length} chars`);
    console.log(`---\n${threadText}---\n`);

    const totalStart = Date.now();
    const result = await extractTimeline(comment, LLM_BASE_URL, LLM_MODEL, LLM_API_KEY);
    const totalMs = Date.now() - totalStart;

    console.log(`\nStatus: ${result.status} (${totalMs}ms total)\n`);

    if (result.parsed) {
      console.log(JSON.stringify(result.parsed, null, 2));
    }
    if (result.errors) {
      console.log("Validation errors:", result.errors.join("; "));
    }
    if (result.reason) {
      console.log("Reason:", result.reason);
    }
    if (result.attempts) {
      console.log("\nAttempt details:");
      for (const a of result.attempts) {
        const parts = [`attempt ${a.attempt}: ${a.ms}ms`];
        if (a.error) parts.push(`error: ${a.error}`);
        if (a.response === "null") parts.push("response: null");
        if (a.errors) parts.push(`errors: ${a.errors.join("; ")}`);
        console.log("  " + parts.join(", "));
      }
    }
  }

  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { extractTimeline, formatThread, findInTree, buildPrompt, validate, DATE_FIELDS, MAX_RETRIES };
