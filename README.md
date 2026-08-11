# Citizen Timeline

A pipeline that scrapes Canadian citizenship application timelines from Reddit, extracts structured data using an LLM, and visualizes the results in a browser-based dashboard.

## Architecture

```
Reddit API  →  fetch.js   →  data/comments_raw.json   (scraped comment tree)
                                ↓
LLM API     →  reddit.js  →  data/{id}.json            (extracted timelines)
                                ↓
Browser     →  app.js     →  Interactive table with filters, sorting, and side panel
```

## Setup

### Requirements
- Node.js >= 18
- A Reddit account cookie (for scraping)
- An OpenAI-compatible LLM API endpoint (e.g. Ollama, DeepSeek, OpenAI)

### Install

```bash
git clone https://github.com/ImranR98/citizen-timeline.git
cd citizen-timeline
npm install
cp .env.example .env
```

### Configure

Edit `.env`:

```bash
REDDIT_COOKIE=...            # Your Reddit session cookie
LLM_BASE_URL=...             # OpenAI-compatible API base URL
LLM_MODEL=...                # Model name
LLM_API_KEY=...              # API key (optional for local LLMs)
LLM_TEST_MODE=1              # Only process 5 random comments
# LLM_CONCURRENCY=20         # Parallel LLM requests (default: 20)
# SCRAPE_INTERVAL_HOURS=24   # Interval between scrape cycles (default: 24)
# PORT=3000                  # HTTP server port (default: 3000)
# NTFY_URL=...               # ntfy.sh topic URL for notifications (optional)
# NTFY_AUTH=...              # ntfy.sh auth header (optional)
```

To get your Reddit cookie: log into Reddit in your browser, open DevTools → Application → Cookies → copy the entire cookie string.

### Notifications (optional)

Set `NTFY_URL` to receive push notifications via [ntfy.sh](https://ntfy.sh) for important events:

| Event | Priority | When |
|---|---|---|
| Server started | 3 | Once on startup |
| Scrape completed | 3 | Only when new/changed comments were processed or failures occurred |
| Scrape failed | 4 | Reddit API or LLM API errors |
| Cookie expiring | 4–5 | When the Reddit session cookie has ≤ 7 days remaining |
| Server crash | 5 | Uncaught exceptions or unhandled promise rejections |

Set `NTFY_AUTH` if your ntfy topic requires authentication (e.g. `Bearer tk_...`). Leave both unset to skip notifications.

### Run

`main.js` starts both the scraper loop and the web dashboard:

```bash
node main.js
# → Server at http://localhost:3000
# → Scrape runs immediately, then every 24 hours (configurable)
```

Or run a one-off scrape:

```bash
node scrape.js              # Full pipeline (reads TEST_MODE from env)
LLM_TEST_MODE=1 node scrape.js  # Process only 5 random comments
```

## Single-comment debugging

```bash
node reddit.js <comment_id>            # Test extraction on one comment
node reddit.js --show-prompt <id>      # Also print the full LLM prompt
```

## How it works

1. **Scraping** — `fetch.js` hits Reddit's JSON API with pagination (`?limit=1500`) to fetch all top-level comments and nested replies.

2. **Extraction** — `reddit.js` formats a comment + its same-author replies into a thread, sends it to the LLM with system/user messages and 7 few-shot examples, parses the JSON response, and validates dates for format and chronological order. Invalid responses retry up to 3 times.

3. **Caching** — `scrape.js` uses content-hashed state in `data/state.json`. If a comment or any of its replies are edited, the hash changes and it gets re-processed on the next run.

4. **Serving** — `main.js` runs a built-in HTTP server and invokes the scraper on a configurable interval. Cookie expiry is monitored on every loop.

5. **Visualization** — `app.js` fetches all `data/{id}.json` files and renders them with [Tabulator](https://tabulator.info). Columns show wait times in months from the application date. Filters, sorting, column selection, and a side panel with full source threads are all client-side.

## Project structure

```
├── main.js            # Interval server + scraper loop
├── scrape.js          # Pipeline orchestrator (exports run(), CLI mode)
├── fetch.js           # Reddit API scraper
├── reddit.js          # LLM extraction logic (exports extractTimeline, CLI debugging)
├── llm.js             # OpenAI-compatible API client
├── notify.js          # ntfy.sh notification sender
├── index.html         # Dashboard
├── app.js             # Dashboard logic
├── app.css            # Dashboard styles
├── privacy.html       # Privacy policy
├── favicon.svg        # Canadian flag maple leaf (public domain)
├── Dockerfile         # Image: imranrdev/cct26
├── .env.example       # Environment variable template
├── data/              # Scraped + extracted JSON files (gitignored)
│   ├── state.json       # Processed comment hashes
│   ├── last_scrape.json # Timestamp of most recent scrape
│   ├── comments_raw.json# Raw Reddit comment dump
│   └── {id}.json        # Individual extracted timelines
```

## Data schema

Each timeline JSON contains:

| Field | Description |
|---|---|
| `application_date` | Date the application was submitted |
| `aor_date` | Acknowledgement of Receipt date |
| `background_check_date` | Background verification completed |
| `test_invitation_date` | Citizenship test invitation sent |
| `test_taken_date` | Date the test was taken |
| `test_completed_date` | Test marked as completed on tracker |
| `lpp_date` | Language, Physical Presence, Prohibitions completed |
| `oath_scheduled_date` | Oath ceremony scheduled/invitation |
| `oath_ceremony_date` | Oath ceremony date |
| `application_type` | e.g. "Online / Single", "Family of 4" |
| `location` | City with optional IRCC office in brackets |
| `notes` | Free-text notes from LLM extraction |
| `extra_steps` | Array of `{step, date}` for fingerprints, ghost updates, etc. |
| `source` | Original Reddit comment tree |

## License

MIT — see [LICENSE](LICENSE)
