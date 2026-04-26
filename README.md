# Cigar Haven Backend

Cigar price aggregator. The frontend (`index.html`) hits `GET /search?q=<brand>` and renders the results.

Powered by Gemini 2.5 Flash with Google Search grounding. Searches the **open web** for cigar prices — not locked to a fixed retailer list. Whatever Gemini finds, sorted by price.

## What's new in 3.0

- **Open web search.** No more domain whitelist. Backend returns listings from any reputable online cigar retailer Gemini surfaces (JR Cigars, Thompson, CI, Famous Smoke, Holt's, Atlantic Cigar, Best Cigar Prices, etc.).
- `temperature: 0` — same query gives the same results every time.
- `/debug` endpoint shows a `byStore` breakdown so you can see retailer coverage.

## Setup

1. Get a free Gemini API key: <https://aistudio.google.com/app/apikey>
2. On Render, set env var `GEMINI_API_KEY` to that key.
3. Push these files. Render runs `npm install` and starts the server.

After deploy, hit `https://your-app.onrender.com/debug?q=padron` to confirm — `byStore` should show listings spread across multiple retailers.

## Endpoints

- `GET /` — health check
- `GET /search?q=<brand>` — sorted JSON array (frontend uses this)
- `GET /debug?q=<brand>` — full diagnostics (raw output, search queries, sources, byStore breakdown, token usage)

## Frontend tweak (optional)

The current `index.html` has a hardcoded loading message:

> "Pulling live prices from JR Cigars, Thompson, and Cigars International…"

Now that the backend searches the open web, you'll probably want to change that to something like "Pulling live prices from across the web…". Same for the storeOrder list in the JS — it preferentially renders those three first, but everything else still works.

## Env vars

| Var | Default | Notes |
|-----|---------|-------|
| `GEMINI_API_KEY` | (required) | From aistudio.google.com |
| `GEMINI_MODEL` | `gemini-2.5-flash` | |
| `PORT` | `3000` | Render sets this automatically |

## Local dev

```bash
npm install
export GEMINI_API_KEY=your_key_here
npm start
```

Then: <http://localhost:3000/debug?q=padron>
