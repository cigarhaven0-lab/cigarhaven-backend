# Cigar Haven Backend

Cigar price aggregator. The frontend (`index.html`) hits `GET /search?q=<brand>` and renders the results.

Powered by Gemini 2.5 Flash with Google Search grounding — one API call per request, no scrapers, no headless browser, no CSS selectors.

## Setup

1. Get a free Gemini API key: <https://aistudio.google.com/app/apikey> — sign in with Google, click **Get API key**. No credit card required to start.
2. On Render, set env var `GEMINI_API_KEY` to that key.
3. Push these files. Render runs `npm install` and starts the server.

After deploy, hit `https://your-app.onrender.com/debug?q=padron` to confirm it's working — that endpoint shows the raw model output, the actual Google search queries Gemini ran, and the sources it cited.

## Free tier (honest version)

- **Gemini 2.5 Flash:** free, ~10 requests/minute, ~1,000 requests/day.
- **Google Search grounding:** 500 grounded requests/day free on Flash.
- **Possible billing snag:** Google sometimes wants a billing account on file even within the free quota. You stay under the threshold and aren't charged. If grounding errors out with a billing message, add a billing account in Google Cloud Console — your free quota stays free.

## Endpoints

- `GET /` — health check
- `GET /search?q=<brand>` — sorted JSON array (what the frontend uses)
- `GET /debug?q=<brand>` — full diagnostics (raw model output, search queries, sources, token usage)

## Env vars

| Var | Default | Notes |
|-----|---------|-------|
| `GEMINI_API_KEY` | (required) | From aistudio.google.com |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Try `gemini-2.5-flash-lite` to lighten quota use |
| `PORT` | `3000` | Render sets this automatically |

## Local dev

```bash
npm install
export GEMINI_API_KEY=your_key_here
npm start
```

Then: <http://localhost:3000/debug?q=padron>

## Files

- `server.js` — Express server + the Gemini call
- `package.json` — deps: `@google/genai`, `express`, `cors`
- `render.yaml` — Render service config
