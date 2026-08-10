# Citizen Timeline

A pipeline that scrapes Canadian citizenship application timelines from Reddit, extracts structured data using an LLM, and visualizes the results in a browser-based dashboard.

## Architecture

```
Reddit API  →  scrape.js  →  comments_raw.json
                                ↓
LLM API     →  prompt.js  ←  (extract timelines with dates)
                                ↓
                        data/{id}.json  +  data/state.json
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
git clone https://github.com/ImranR98/canadian-citizenship-timelines-2026.git
cd canadian-citizenship-timelines-2026
npm install
cp .env.example .env
```

### Configure

Edit `.env`:

```bash
REDDIT_COOKIE=...           # Your Reddit session cookie
LLM_BASE_URL=...            # OpenAI-compatible API base URL
LLM_MODEL=...               # Model name
LLM_API_KEY=...             # API key (optional for local LLMs)
LLM_TEST_MODE=1             # Only process 5 random comments
# LLM_CONCURRENCY=20        # Parallel LLM requests (default: 20)
# NTFY_URL=...               # ntfy.sh topic URL for notifications (optional)
# NTFY_AUTH=...               # ntfy.sh auth header (optional)
```

To get your Reddit cookie: log into Reddit in your browser, open DevTools → Application → Cookies → copy the entire cookie string.

### Notifications (optional)

Set `NTFY_URL` to receive push notifications via [ntfy.sh](https://ntfy.sh) for important events:

| Event | Priority | When |
|---|---|---|
| Server started | 3 | Once on startup |
| Scrape completed | 3 | Only when new/existing comments were processed or failures occurred |
| Scrape failed | 4 | Reddit API or LLM API errors |
| Server crash | 5 | Uncaught exceptions or unhandled promise rejections |

Set `NTFY_AUTH` if your ntfy topic requires authentication (e.g. `Bearer tk_...`). Leave both unset to skip notifications.

### Run the scraper + LLM pipeline

```bash
# Test mode — process only 5 random comments
node main.js

# Production — process all comments (disable test mode first)
unset LLM_TEST_MODE
node main.js
```

The first run scrapes all comments from the megathread and saves a raw dump to `comments_raw.json`. Each comment is sent to the LLM with its replies to extract structured timeline data. Results land in `data/` as individual JSON files. Re-running skips unchanged comments.

### View the dashboard

```bash
npx serve .
# Open http://localhost:3000
```

The dashboard shows all processed timelines in a sortable, filterable table with averages, stage checkboxes, and a detail panel for each entry.

## Single-comment debugging

```bash
node prompt.js <comment_id>           # Test extraction on one comment
node prompt.js --show-prompt <id>     # Also print the full LLM prompt
```

## How it works

1. **Scraping** — `scrape.js` hits Reddit's JSON API with pagination (`?limit=1500`) to fetch all top-level comments and nested replies. Comments with `[deleted]` or `[removed]` bodies are skipped.

2. **Extraction** — `prompt.js` formats a comment + its same-author replies into a thread, sends it to the LLM with system/user messages and few-shot examples, parses the JSON response, and validates dates for format and chronological order. Invalid responses retry up to 3 times.

3. **Caching** — `main.js` uses content-hashed state in `data/state.json`. If a comment or any of its replies are edited, the hash changes and it gets re-processed on the next run.

4. **Visualization** — `app.js` fetches all `data/{id}.json` files and renders them with [Tabulator](https://tabulator.info). Columns show wait times in months from the application date. Filters, sorting, column selection, and a side panel with full source threads are all client-side.

## Project structure

```
├── scrape.js          # Reddit scraper (exports scrape function)
├── prompt.js          # LLM extraction logic (exports extractTimeline, CLI mode)
├── llm.js             # OpenAI-compatible API client
├── main.js            # Pipeline orchestrator
├── index.html         # Dashboard
├── app.js             # Dashboard logic
├── app.css            # Dashboard styles
├── .env.example       # Environment variable template
├── data/              # Scraped + extracted JSON files (gitignored)
│   ├── state.json     # Processed comment hashes
│   └── {id}.json      # Individual extracted timelines
└── comments_raw.json  # Raw Reddit comment dump (gitignored)
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
