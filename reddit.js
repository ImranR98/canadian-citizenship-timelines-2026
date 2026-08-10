const { prompt: callLLM } = require("./llm");
const { scrape } = require("./fetch");
const crypto = require("crypto");
const fs = require("fs");

const MAX_RETRIES = 3;

const DATE_FIELDS = [
  "application_date", "aor_date", "background_check_date",
  "test_invitation_date", "test_taken_date", "test_completed_date",
  "lpp_date", "oath_scheduled_date", "oath_ceremony_date"
];

function buildSystemPrompt() {
  return `You are an assistant that extracts Canadian citizenship application timelines from Reddit comment threads.

BACKGROUND:
This is a megathread where Canadian citizenship applicants post their application progress. The IRCC (Immigration, Refugees and Citizenship Canada) process consists of these steps:
- Application submitted → AOR (Acknowledgement of Receipt) → Background check → Test invitation → Test taken → Test completed → LPP (Language, Physical Presence, Prohibitions) → Oath scheduled → Oath ceremony
- Some applicants report optional extra steps: fingerprint requests/submissions, ghost updates (tracker activity with no status change), interviews, document resubmissions
- "In Progress", "Completed", and "Not Started" are tracker statuses — they are NOT dates
- "Test Invite" means the email was sent with a test-taking window; the test is taken sometime within that window
- "LPP" covers three checks (Language, Physical Presence, Prohibitions) that usually complete together
- "Oath in Progress" / "Oath date" / "Oath email" / "Oath ceremony" are distinct dates users may report
- Applicants sometimes mention their IRCC processing office (e.g. Sydney, Vancouver, Kitchener, Montreal). If mentioned, combine it with the city in the location field: "Vancouver [Sydney]"

RULES:
1. Extract dates ONLY if they are explicitly stated in the text, or can be directly inferred from an explicit relative reference ("a month ago", "last week", "2 weeks back") anchored to the comment's edit date (if edited) or post date (if not edited). For example: comment has edit date 2026-08-04 and user says "test approved a month ago" → test_completed_date is approximately 2026-07-04.
2. NEVER invent or hallucinate dates. If a year is ambiguous (e.g. "April 26" without a year), infer the year from context (the comment's post date, the general era of the thread). If you infer a year, note that in the notes field.
3. Extracted dates must not be in the future relative to the comment's edit date (if the comment was edited) or post date (if never edited). Users often edit their original comments to add progress updates as their application advances, so dates newer than the original post date are valid as long as they are not newer than the edit date.
4. Each comment header shows the author after "by" (e.g. "by johndoe"). Only replies from the SAME author as the top-level comment belong to that applicant's report. Replies from different authors are OTHER PEOPLE and their timeline information must NOT be merged. Extract data only from the top-level comment plus any nested replies by the same author.
5. If the comment thread does NOT contain any citizenship application timeline/progress report (e.g. it is just a question, off-topic discussion, congratulations, or general chat), return exactly the string: null
6. If the comment thread is a timeline but only mentions an application date and nothing else, you may still extract it — but if the comment mentions later steps (AOR, test, etc.), include those dates too. Do not output an object containing ONLY application_date when later steps are mentioned.
7. All non-null step dates must be newer than or equal to application_date. If application_date is present, no other date may come before it.`;
}

function buildUserPrompt(threadText) {
  return `Below are 6 examples showing how to extract timelines. Study them, then process the target thread at the end.

--- EXAMPLE 1: Clean structured timeline ---
[id: a1] by applicant1 (posted 2026-08-06) My timeline:
Ottawa, family of 2
Office Sydney
. Application submitted- Feb 7 2026
.AOR- 22 April
. Background verification- 24 April
.citizenship test - 22 May
. Test marked completed - JUNE 4
. LPP completed - 24 june
. Oath date 6 Aug

Expected output:
${example1()}

--- EXAMPLE 2: Relative date inference ---
[id: b1] by applicant2 (posted 2026-08-04) I got my test approved a month ago now, still nothing on LPP.
Is this normal?

Expected output:
${example2()}

--- EXAMPLE 3: Mixed timeline + question ---
[id: c1] by applicant3 (posted 2026-08-06) Citizenship application filed: April 17, 2026
AOR received: July 24, 2026
Test notification received: August 5, 2026

Question: How long does it usually take to monitor progress on the tracker?

Expected output:
${example3()}

--- EXAMPLE 4: Sparse report with year disambiguation ---
[id: d1] by applicant4 (posted 2026-08-05) Single applicant, Vancouver

Application submitted: May 1

AOR received: Aug 5

Expected output:
${example4()}

--- EXAMPLE 5: Timeline update in replies (same author) ---
[id: e1] by applicant5 (posted 2026-07-20) Applied May 4, 2026. Still waiting for AOR.
  [id: e2] by applicant5 (posted 2026-08-06) Update: got my AOR today! Aug 6

Expected output:
${example5()}

--- EXAMPLE 6: Not a timeline ---
[id: f1] by randomuser (posted 2026-08-06) Does IRCC use my residential address or mailing address to determine my processing office? Has anyone had different addresses and been able to confirm which one was used?

Expected output:
null

---

TARGET COMMENT THREAD (extract timeline from this one):
${threadText}`;
}

function example1() {
  return JSON.stringify({
    application_date: "2026-02-07",
    aor_date: "2026-04-22",
    background_check_date: "2026-04-24",
    test_invitation_date: null,
    test_taken_date: "2026-05-22",
    test_completed_date: "2026-06-04",
    lpp_date: "2026-06-24",
    oath_scheduled_date: null,
    oath_ceremony_date: "2026-08-06",
    application_type: null,
    location: "Ottawa [Sydney]",
    notes: "Family of 2.",
    extra_steps: []
  }, null, 2);
}

function example2() {
  return JSON.stringify({
    application_date: null,
    aor_date: null,
    background_check_date: null,
    test_invitation_date: null,
    test_taken_date: null,
    test_completed_date: "2026-07-04",
    lpp_date: null,
    oath_scheduled_date: null,
    oath_ceremony_date: null,
    application_type: null,
    location: null,
    notes: "Test completed date inferred from 'a month ago' relative to comment date 2026-08-04. LPP still pending.",
    extra_steps: []
  }, null, 2);
}

function example3() {
  return JSON.stringify({
    application_date: "2026-04-17",
    aor_date: "2026-07-24",
    background_check_date: null,
    test_invitation_date: "2026-08-05",
    test_taken_date: null,
    test_completed_date: null,
    lpp_date: null,
    oath_scheduled_date: null,
    oath_ceremony_date: null,
    application_type: null,
    location: null,
    notes: "Test notification received Aug 5. Also asking about tracker access.",
    extra_steps: []
  }, null, 2);
}

function example4() {
  return JSON.stringify({
    application_date: "2026-05-01",
    aor_date: "2026-08-05",
    background_check_date: null,
    test_invitation_date: null,
    test_taken_date: null,
    test_completed_date: null,
    lpp_date: null,
    oath_scheduled_date: null,
    oath_ceremony_date: null,
    application_type: null,
    location: "Vancouver",
    notes: "Year inferred as 2026 from comment post date.",
    extra_steps: []
  }, null, 2);
}

function example5() {
  return JSON.stringify({
    application_date: "2026-05-04",
    aor_date: "2026-08-06",
    background_check_date: null,
    test_invitation_date: null,
    test_taken_date: null,
    test_completed_date: null,
    lpp_date: null,
    oath_scheduled_date: null,
    oath_ceremony_date: null,
    application_type: null,
    location: null,
    notes: "AOR date reported in reply on Aug 6.",
    extra_steps: []
  }, null, 2);
}

function formatThread(node, depth) {
  depth = depth || 0;
  const indent = "  ".repeat(depth);

  let dateStr = "";
  if (node.created) {
    dateStr = `posted ${node.created}`;
    if (node.edited && node.edited !== node.created) {
      dateStr += `, edited ${node.edited}`;
    }
  }

  const author = node.author || "unknown";
  let text = `${indent}[id: ${node.id}] by ${author} (${dateStr}) ${node.body}\n`;
  for (const reply of node.replies) {
    text += formatThread(reply, depth + 1);
  }
  return text;
}

function hashThread(commentNode) {
  const threadText = formatThread(commentNode);
  return crypto.createHash("sha256").update(threadText).digest("hex");
}

function buildRetryPrompt(errors, systemPrompt, userPrompt) {
  const feedback = `Your previous response was invalid. Errors:\n${errors.join(";\n")}\n\nPlease fix these issues and try again.\n\n`;
  return { system: systemPrompt, user: feedback + userPrompt };
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

  const hasAnyDate = DATE_FIELDS.some(field => epochDates[field] !== null);
  const hasExtraSteps = Array.isArray(extracted.extra_steps) && extracted.extra_steps.length > 0;
  if (!hasAnyDate && !hasExtraSteps) {
    errors.push("No dates found — if the comment contains timeline info, dates should be extracted or inferred from relative references (e.g. 'a month ago')");
  }
  const onlyAppDate = epochDates.application_date !== null
    && DATE_FIELDS.slice(1).every(field => epochDates[field] === null)
    && !hasExtraSteps;
  if (onlyAppDate) {
    errors.push("Only application_date found — likely incomplete extraction");
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
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(threadText);
  const attempts = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const sp = systemPrompt;
    let up;
    if (attempt === 0) {
      up = userPrompt;
    } else {
      const retry = buildRetryPrompt(lastErrors, systemPrompt, userPrompt);
      up = retry.user;
    }

    const t0 = Date.now();
    let response;
    try {
      response = await callLLM(sp, up, baseUrl, model, apiKey);
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

  const args = process.argv.slice(2);
  const showPrompt = args.includes("--show-prompt");
  const targetId = args.find(a => !a.startsWith("--")); if (!targetId) {
    console.error("Usage: node prompt.js [--show-prompt] <comment_id>");
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
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(threadText);

    if (showPrompt) {
      console.log("========== SYSTEM MESSAGE ==========");
      console.log(systemPrompt);
      console.log("========== USER MESSAGE ==========");
      console.log(userPrompt);
      console.log("===================================\n");
    }

    const hash = hashThread(comment);
    console.log(`Comment: ${comment.id}`);
    console.log(`Reply count: ${comment.replies.length}`);
    console.log(`Hash: ${hash}`);
    console.log(`Thread (${threadText.length} chars):`);
    console.log(`---\n${threadText}---\n`);

    const totalStart = Date.now();
    const result = await extractTimeline(comment, LLM_BASE_URL, LLM_MODEL, LLM_API_KEY);
    const totalMs = Date.now() - totalStart;

    console.log(`\nStatus: ${result.status} (${totalMs}ms total)\n`);

    if (result.parsed) {
      const output = Object.assign({}, result.parsed, { source: comment });
      console.log(JSON.stringify(output, null, 2));
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

module.exports = { extractTimeline, formatThread, hashThread, findInTree, buildSystemPrompt, buildUserPrompt, validate, DATE_FIELDS, MAX_RETRIES };
