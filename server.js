/**
 * Cigar Haven Backend — Gemini + Google Search grounding.
 *
 * Searches the open web for cigar prices across ANY reputable online retailer,
 * not a fixed list. Returns deterministic results (temperature: 0) sorted by
 * price.
 *
 * Required env: GEMINI_API_KEY  (free key from https://aistudio.google.com)
 * Optional env: GEMINI_MODEL    (default: gemini-2.5-flash)
 */

const express = require("express");
const cors = require("cors");

const genaiMod = require("@google/genai");
const GoogleGenAI = genaiMod.GoogleGenAI || genaiMod.default || genaiMod;

const app = express();
app.use(cors());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const SYSTEM_PROMPT = `You are the search backend for "Cigar Haven", a cigar price comparison site that finds the best online prices for cigars across the open web.

YOUR JOB
Given a cigar brand or product query, search the open web for current online retail listings and return them as JSON. You are NOT limited to a fixed list of retailers — search broadly and surface the best prices wherever they exist.

SEARCH STRATEGY
Run multiple Google searches to get good coverage:
  1. "<query> cigars price"
  2. "<query> cigars online buy"
  3. "<query> cigars cheapest"
  4. Optionally narrow by specific large retailers if it helps:
       site:jrcigars.com, site:thompsoncigar.com, site:cigarsinternational.com,
       site:famous-smoke.com, site:holts.com, site:smallbatchcigar.com,
       site:cigarpage.com, site:atlanticcigar.com, site:bestcigarprices.com, etc.

Aim to surface 10-25 listings total across as many distinct retailers as you can find. Variety of retailers matters more than depth at one retailer — the goal is best-price comparison.

OUTPUT FORMAT
Your final response MUST be ONLY a JSON array — no prose, no preamble, no markdown code fences, no commentary. The first character must be '[' and the last must be ']'.

Each item in the array MUST have this exact shape:
{
  "store": "<human-readable retailer name, e.g. 'JR Cigars', 'Famous Smoke Shop', 'Holt's Cigar Company'>",
  "name": "<full product name as listed>",
  "price": "$<number>",
  "url": "<full https URL of the actual product page>",
  "pack": "<e.g. 'Box of 20', 'Single', 'Bundle of 25', '5 Pack', or 'N/A'>",
  "inStock": true | false
}

HARD RULES
- Output JSON ONLY. No prose before or after. No code fences.
- Only include listings you actually found via Google Search. Never invent products, prices, or URLs.
- "store" should be the human-readable retailer name, derived from the page title or the domain (e.g. jrcigars.com → "JR Cigars", famous-smoke.com → "Famous Smoke Shop").
- "price" must start with "$" followed by a number (e.g. "$24.99", "$189").
- "url" MUST be copied character-for-character from the actual Google Search result URL. Do NOT construct, guess, shorten, or modify URLs in any way. If you do not have an exact confirmed product page URL from your search results, omit that listing entirely — a missing listing is better than a broken link.
- "url" must point to a specific product page on the retailer's domain — not a category page, search results page, or aggregator/comparison site.
- Skip auction sites (eBay listings vary), marketplaces (Amazon, Walmart unless they're the retailer), and review/news articles.
- Set "inStock" to false ONLY if the listing explicitly says "out of stock" or "sold out". Otherwise true.`;

async function searchWithGemini(query, opts = {}) {
  const excludeDomains = Array.isArray(opts.excludeDomains) ? opts.excludeDomains : [];

  const baseMessage =
    `Find current online cigar listings for: "${query}"\n\n` +
    `Search the open web. Surface 10-25 listings across as many distinct ` +
    `retailers as you can. Return the JSON array exactly as specified — your ` +
    `entire response must be the JSON array, nothing else.`;

  const userMessage = excludeDomains.length
    ? baseMessage +
      `\n\nWe already have listings from these retailers:\n` +
      excludeDomains.map((d) => `- ${d}`).join("\n") +
      `\n\nPlease prioritize finding listings from OTHER retailers we ` +
      `haven't covered yet — smaller specialty cigar shops, regional ` +
      `retailers, boutique online stores, etc. Cast a wide net. If the ` +
      `same product appears on a new retailer at a different price, include it.`
    : baseMessage;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: userMessage,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ googleSearch: {} }],
      // Pinned to 0 for deterministic output across runs
      temperature: 0,
    },
  });

  let rawText = "";
  try {
    rawText = (response.text || "").trim();
  } catch (_) {
    rawText = "";
  }
  if (!rawText) {
    const parts = response?.candidates?.[0]?.content?.parts || [];
    rawText = parts.map((p) => p.text || "").join("").trim();
  }

  const items = parseJsonArray(rawText);

  const now = new Date().toLocaleString();
  const prelim = items.filter(isValidItem).map((it) => ({
    store: String(it.store).trim(),
    name: String(it.name).trim(),
    price: String(it.price).trim(),
    url: String(it.url).trim(),
    pack: it.pack ? String(it.pack).trim() : "N/A",
    inStock: it.inStock !== false,
    lastChecked: now,
    sourceType: "ai",
  }));

  // Verify each URL actually resolves. Gemini sometimes constructs plausible
  // product URLs that 404. Drop items whose URL doesn't return a successful
  // response so users never see a broken link.
  const verifications = await Promise.all(
    prelim.map(async (it) => ({ item: it, ok: await verifyUrl(it.url) }))
  );
  const cleaned = verifications.filter((v) => v.ok).map((v) => v.item);
  const droppedUrls = verifications.filter((v) => !v.ok).map((v) => v.item.url);

  const groundingMeta = response?.candidates?.[0]?.groundingMetadata || null;
  const searchQueries = groundingMeta?.webSearchQueries || [];
  const sources = (groundingMeta?.groundingChunks || [])
    .map((c) => c?.web?.title)
    .filter(Boolean);

  return {
    results: cleaned,
    debug: {
      rawText,
      model: MODEL,
      itemCountRaw: items.length,
      itemCountClean: cleaned.length,
      searchQueries,
      sources,
      usage: response?.usageMetadata || null,
      droppedUrls,
    },
  };
}

// Run two Gemini passes back-to-back to maximize retailer coverage. Pass 1
// does a broad search. Pass 2 is told which domains pass 1 already covered
// and is asked to focus on OTHER retailers (specialty / regional / boutique
// shops Gemini might otherwise skip). Results are merged and deduped by
// canonical URL so a retailer appearing in both passes only shows up once.
async function searchTwoPasses(query) {
  const pass1 = await searchWithGemini(query);

  const seenDomains = uniqueDomains(pass1.results);
  const pass2 = await searchWithGemini(query, { excludeDomains: seenDomains });

  const merged = dedupeByUrl([...pass1.results, ...pass2.results]);

  const pass1Keys = new Set(pass1.results.map((it) => canonicalUrlKey(it.url)));
  const newInPass2 = pass2.results.filter(
    (it) => !pass1Keys.has(canonicalUrlKey(it.url))
  ).length;

  return {
    results: merged,
    debug: {
      model: pass1.debug.model,
      itemCountRaw: pass1.debug.itemCountRaw + pass2.debug.itemCountRaw,
      itemCountClean: merged.length,
      itemCountFromPass1: pass1.results.length,
      itemCountFromPass2: pass2.results.length,
      itemCountNewInPass2: newInPass2,
      pass1Domains: seenDomains,
      pass2Domains: uniqueDomains(pass2.results),
      searchQueries: [
        ...(pass1.debug.searchQueries || []),
        ...(pass2.debug.searchQueries || []),
      ],
      sources: [
        ...(pass1.debug.sources || []),
        ...(pass2.debug.sources || []),
      ],
      usage: { pass1: pass1.debug.usage, pass2: pass2.debug.usage },
      droppedUrls: [
        ...(pass1.debug.droppedUrls || []),
        ...(pass2.debug.droppedUrls || []),
      ],
      rawText: `--- PASS 1 ---\n${pass1.debug.rawText}\n\n--- PASS 2 ---\n${pass2.debug.rawText}`,
    },
  };
}

function canonicalUrlKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return (u.protocol + "//" + host + path + u.search).toLowerCase();
  } catch (_) {
    return String(url || "").toLowerCase();
  }
}

function dedupeByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = canonicalUrlKey(it.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function uniqueDomains(items) {
  const set = new Set();
  for (const it of items) {
    try {
      const host = new URL(it.url).hostname.toLowerCase().replace(/^www\./, "");
      if (host) set.add(host);
    } catch (_) {}
  }
  return [...set];
}

// Verify a URL points to a real product page. Many retailers serve "soft
// 404" pages — HTTP 200 with a "Page Not Found" body — for missing
// products, so a status-only check lets broken links through to users.
// This GETs the first 64KB, follows redirects with a browser-like
// User-Agent, then rejects if:
//   - status is 4xx/5xx
//   - the final URL path looks like /404, /not-found, etc.
//   - <title> or <h1> contains "page not found" / "404 error" markers
async function verifyUrl(url) {
  if (!url || typeof url !== "string") return false;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
      "image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Range": "bytes=0-65535",
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers,
      signal: ctrl.signal,
    });

    if (resp.status < 200 || resp.status >= 400) return false;
    if (looksLikeNotFoundUrl(resp.url || url)) return false;

    let body = "";
    try {
      body = await resp.text();
    } catch (_) {
      // Status was OK but body couldn't be read — accept rather than
      // drop a potentially good listing.
      return true;
    }
    return !looksLikeNotFoundBody(body);
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeNotFoundUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /(?:^|\/)(?:404|not[-_]?found|page[-_]?not[-_]?found|error[-_]?(?:404|page))(?:\/|\.html?|$)/.test(
      pathname
    );
  } catch (_) {
    return false;
  }
}

// Soft-404 detection: looks for "page not found" markers in <title> and
// <h1>. These phrases on a real cigar product page would be very
// surprising, so they're a strong signal the URL is dead even when the
// server returned HTTP 200.
const NOT_FOUND_RE =
  /page\s+not\s+found|404\s+not\s+found|not\s+found\s*[-—|:]\s*404|404\s+error|error\s+404|404\s*[-—|:]\s*(?:not\s+found|error|page)|page\s+(?:doesn'?t|does\s+not)\s+exist|we\s+(?:can'?t|cannot|couldn'?t)\s+find\s+(?:that|the|this)|sorry,?\s+(?:we\s+)?(?:can'?t|couldn'?t)\s+find|the\s+page\s+you'?re\s+looking\s+for|product\s+(?:is\s+)?no\s+longer\s+available|this\s+page\s+(?:is\s+)?(?:no\s+longer\s+)?(?:available|unavailable)/i;

function looksLikeNotFoundBody(body) {
  if (!body || typeof body !== "string") return false;

  const titleMatch = body.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].replace(/<[^>]+>/g, " ").trim();
    if (NOT_FOUND_RE.test(title)) return true;
    // Whole-title matches like "404", "Not Found", "404 Not Found".
    if (/^(?:404|not\s+found|404\s*[-—|:]?\s*not\s+found)\s*$/i.test(title)) return true;
  }

  const h1Match = body.match(/<h1\b[^>]*>([\s\S]{0,500}?)<\/h1>/i);
  if (h1Match) {
    const h1 = h1Match[1].replace(/<[^>]+>/g, " ").trim();
    if (NOT_FOUND_RE.test(h1)) return true;
    if (/^(?:404|not\s+found|oops!?)\s*$/i.test(h1)) return true;
  }

  return false;
}

function parseJsonArray(text) {
  if (!text) return [];

  let s = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(s.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }

  const objects = [];
  const matches = s.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || [];
  for (const m of matches) {
    try {
      objects.push(JSON.parse(m));
    } catch (_) {}
  }
  return objects;
}

// Light sanity check: required fields, price format, real http(s) URL.
// No domain whitelist — Gemini can return any retailer.
function isValidItem(it) {
  if (!it || typeof it !== "object") return false;
  if (!it.store || !it.name || !it.price || !it.url) return false;
  if (typeof it.price !== "string" || !it.price.includes("$")) return false;
  if (typeof it.url !== "string" || !/^https?:\/\/[^\s]+\.[^\s]+/i.test(it.url)) return false;
  return true;
}

function sortByPrice(arr) {
  return [...arr].sort((a, b) => {
    const pa = parseFloat(String(a.price || "").replace(/[^0-9.]/g, "")) || 999999;
    const pb = parseFloat(String(b.price || "").replace(/[^0-9.]/g, "")) || 999999;
    return pa - pb;
  });
}

// ---------- routes ----------

app.get("/", (req, res) => {
  res.send("Cigar Haven Backend running ✅ (Gemini + open web search)");
});

app.get("/search", async (req, res) => {
  const query = (req.query.q || "").toString().trim();
  if (!query) return res.json({ error: "No search query provided" });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not set on the server" });
  }

  console.log(`[search] query: "${query}" model=${MODEL}`);
  try {
    const { results, debug } = await searchTwoPasses(query);
    const sorted = sortByPrice(results);
    const byStore = sorted.reduce((acc, r) => ((acc[r.store] = (acc[r.store] || 0) + 1), acc), {});
    console.log(
      `[search] returned ${sorted.length} results ` +
        `(pass1=${debug.itemCountFromPass1}, pass2=${debug.itemCountFromPass2}, ` +
        `newInPass2=${debug.itemCountNewInPass2}, ` +
        `droppedBrokenUrls=${debug.droppedUrls.length}, ` +
        `searches=${debug.searchQueries.length}) ` +
        `byStore=${JSON.stringify(byStore)}`
    );
    res.json(sorted);
  } catch (err) {
    console.error("[search] failed:", err.message);
    res.status(500).json({ error: err.message || "Search failed" });
  }
});

app.get("/debug", async (req, res) => {
  const query = (req.query.q || "padron").toString().trim();
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not set on the server" });
  }

  console.log(`[debug] query: "${query}"`);
  try {
    const { results, debug } = await searchTwoPasses(query);
    const byStore = results.reduce((acc, r) => ((acc[r.store] = (acc[r.store] || 0) + 1), acc), {});
    res.json({
      query,
      model: debug.model,
      itemCountRaw: debug.itemCountRaw,
      itemCountClean: debug.itemCountClean,
      itemCountFromPass1: debug.itemCountFromPass1,
      itemCountFromPass2: debug.itemCountFromPass2,
      itemCountNewInPass2: debug.itemCountNewInPass2,
      pass1Domains: debug.pass1Domains,
      pass2Domains: debug.pass2Domains,
      byStore,
      searchQueries: debug.searchQueries,
      sources: debug.sources,
      usage: debug.usage,
      droppedUrls: debug.droppedUrls,
      rawText: debug.rawText,
      results: sortByPrice(results),
    });
  } catch (err) {
    console.error("[debug] failed:", err.message);
    res.status(500).json({ query, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cigar Haven Backend listening on port ${PORT} — model=${MODEL}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn("⚠️  GEMINI_API_KEY is not set — /search and /debug will fail until you set it.");
  }
});
