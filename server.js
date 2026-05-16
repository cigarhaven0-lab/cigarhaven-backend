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

Aim to surface 20-40 listings total across as many distinct retailers as you can find. Variety of retailers matters more than depth at one retailer — the goal is best-price comparison. More is better.

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
- Skip auction sites (eBay listings vary), marketplaces (Amazon, Walmart unless they're the retailer), and review/news articles.
- Set "inStock" to false ONLY if the listing explicitly says "out of stock" or "sold out". Otherwise true.

URL STRICTNESS — READ CAREFULLY
Every "url" MUST go directly to ONE specific cigar product page where a user can add that exact cigar to their cart. NOT a brand page, category page, search page, or listing page.

  GOOD (specific product, user can buy this exact cigar):
    https://www.jrcigars.com/padron-1964-anniversary-maduro-no-4-5-pack
    https://www.famous-smoke.com/padron+1964+anniversary+natural+no.+4/item/PAD1964N4
    https://www.cigarsinternational.com/p/padron-1964-anniversary-maduro-no-4/2024212/
    https://www.holts.com/padron-1964-anniversary-maduro-no-4.html

  BAD (brand/category landing — sends user to a list, not a cigar):
    https://www.jrcigars.com/padron-cigars
    https://www.jrcigars.com/shop/padron
    https://www.jrcigars.com/brands/padron
    https://www.famous-smoke.com/padron-cigars
    https://www.cigarsinternational.com/c/padron-cigars/
    https://www.holts.com/padron.html

  BAD (search results page):
    https://www.jrcigars.com/search?q=padron
    https://www.famous-smoke.com/searchresults.aspx?q=padron

A valid product URL almost always contains the specific cigar's identifying details — vitola/size (e.g. "no-4", "robusto", "toro"), wrapper (e.g. "maduro", "natural"), and/or pack count (e.g. "5-pack", "box-of-20"), or a unique numeric/SKU product ID. If your URL doesn't pin down a specific cigar SKU, OMIT that listing.`;

async function searchWithGemini(query, opts = {}) {
  const excludeDomains = Array.isArray(opts.excludeDomains) ? opts.excludeDomains : [];

  const baseMessage =
    `Find current online cigar listings for: "${query}"\n\n` +
    `Search the open web. Surface 20-40 listings across as many distinct ` +
    `retailers as you can — variety matters. Return the JSON array exactly ` +
    `as specified — your entire response must be the JSON array, nothing else.\n\n` +
    `Reminder: every URL must go to a SPECIFIC cigar product page, not a ` +
    `brand/category landing page. If you only have a brand URL, skip that listing.`;

  const userMessage = excludeDomains.length
    ? baseMessage +
      `\n\nWe already have listings from these retailers, so DO NOT return ` +
      `more results from these domains — focus this entire search on OTHER ` +
      `retailers we haven't hit yet:\n` +
      excludeDomains.map((d) => `- ${d}`).join("\n") +
      `\n\nFind 15-30 listings from DIFFERENT retailers. Strategies:\n` +
      `  - Run "<query> cigars" + the names of specialty cigar shops you ` +
      `know of (not the big chains above)\n` +
      `  - Try regional retailers (Florida, Texas, NJ, NY cigar shops)\n` +
      `  - Try boutique / curated online cigar stores\n` +
      `  - Try direct-from-manufacturer sites if applicable\n` +
      `  - Try "<query> cigars buy" + "site:" with smaller domains\n` +
      `Go deeper into the search results than you normally would. If a ` +
      `retailer above appears again, skip it — only return listings from ` +
      `domains NOT in the list above.`
    : baseMessage;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: userMessage,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ googleSearch: {} }],
      // Both passes run deterministic — temperature > 0 made Gemini
      // hallucinate URLs that 404 (it would "guess" plausible product
      // slugs instead of sticking to URLs Google Search actually
      // returned). The different prompt is enough to make pass 2 differ.
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

// Verify a URL points to a real, specific product page. Drops:
//   - 4xx/5xx responses
//   - final URLs that look like /404, /not-found, /search?q=, etc.
//   - "soft 404" pages (HTTP 200 with "Page Not Found" in <title>/<h1>)
//   - category / listing / brand-landing pages (JSON-LD CollectionPage /
//     ItemList / SearchResultsPage, or og:type=website with many product
//     cards) so the user lands on a specific cigar, not a brand index
// GETs the first 128KB so JSON-LD blocks lower in <head> still get seen.
async function verifyUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (urlLooksLikeSearchOrCategory(url)) return false;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
      "image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Range": "bytes=0-131071",
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
    const finalUrl = resp.url || url;
    if (looksLikeNotFoundUrl(finalUrl)) return false;
    if (urlLooksLikeSearchOrCategory(finalUrl)) return false;
    if (redirectedToRoot(url, finalUrl)) return false;

    let body = "";
    try {
      body = await resp.text();
    } catch (_) {
      // Status was OK but body couldn't be read — accept rather than
      // drop a potentially good listing.
      return true;
    }
    if (looksLikeNotFoundBody(body)) return false;
    if (looksLikeListingPage(body)) return false;
    return true;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// URL-level filter for obvious search pages. Conservative — only matches
// patterns that are essentially never product pages on any site. (`s` and
// `keyword` params look like search but also commonly mean session-id or
// other things, so we don't use them.)
function urlLooksLikeSearchOrCategory(url) {
  try {
    const u = new URL(url);
    const sp = u.searchParams;
    if (sp.has("q") || sp.has("query") || sp.has("search")) return true;
    const path = u.pathname.toLowerCase();
    if (/\/search(?:\/|$|\.\w+)/.test(path)) return true;
    if (/\/searchresults(?:\.|\/|$)/.test(path)) return true;
    return false;
  } catch (_) {
    return false;
  }
}

// Detect category/listing/brand-landing pages so users don't get sent to
// a "browse all Padron" index instead of a specific cigar. Only drops on
// strong evidence — ItemList alone isn't enough (many real product pages
// use ItemList for breadcrumbs or related-product carousels), and the
// Product card count threshold is generous so product pages with big
// "you may also like" sections aren't misclassified.
function looksLikeListingPage(body) {
  if (!body || typeof body !== "string") return false;

  let productCount = 0;
  let hasCollectionPage = false;
  let hasSearchResultsPage = false;
  const jsonLdBlocks =
    body.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ||
    [];
  for (const block of jsonLdBlocks) {
    productCount += (block.match(/"@type"\s*:\s*"Product"/gi) || []).length;
    if (/"@type"\s*:\s*"CollectionPage"/i.test(block)) hasCollectionPage = true;
    if (/"@type"\s*:\s*"SearchResultsPage"/i.test(block)) hasSearchResultsPage = true;
  }

  const ogTypeMatch =
    body.match(/<meta[^>]+(?:property|name)\s*=\s*["']og:type["'][^>]+content\s*=\s*["']([^"']+)["']/i) ||
    body.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+(?:property|name)\s*=\s*["']og:type["']/i);
  const ogType = ogTypeMatch ? ogTypeMatch[1].toLowerCase().trim() : "";

  // Clear product signals → keep the URL.
  if (ogType.startsWith("product")) return false;
  if (productCount >= 1 && productCount <= 14) return false;

  // Clear listing signals → drop the URL.
  if (hasSearchResultsPage) return true;
  if (hasCollectionPage && productCount === 0) return true;
  // Many Product cards with no og:type=product = listing page with cards.
  if (productCount >= 15) return true;

  const titleMatch = body.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].replace(/<[^>]+>/g, " ").trim();
    if (/\bpage\s+\d+\s+of\s+\d+\b/i.test(title)) return true;
    if (/\bshowing\s+\d+\s+(?:of|results|products|items)\b/i.test(title)) return true;
    if (/\b\d+\s+(?:results|products|items)\s+(?:found|available)\b/i.test(title)) return true;
  }

  return false;
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

// Soft-404 detection: looks for "page not found" markers in <title>,
// <h1>, and <h2>. These phrases on a real cigar product page would be
// very surprising, so they're a strong signal the URL is dead even when
// the server returned HTTP 200.
const NOT_FOUND_RE =
  /page\s+not\s+found|404\s+not\s+found|not\s+found\s*[-—|:]\s*404|404\s+error|error\s+404|404\s*[-—|:]\s*(?:not\s+found|error|page)|page\s+(?:doesn'?t|does\s+not)\s+exist|we\s+(?:can'?t|cannot|couldn'?t|could\s+not)\s+find\s+(?:that|the|this|what|the\s+page|the\s+product|any\s+product)|sorry,?\s+(?:we\s+)?(?:can'?t|cannot|couldn'?t|could\s+not)\s+find|the\s+page\s+you'?re\s+looking\s+for|(?:product|item|listing)\s+(?:is\s+)?(?:not\s+found|unavailable|no\s+longer\s+available)|this\s+page\s+(?:is\s+)?(?:no\s+longer\s+)?(?:available|unavailable)|page\s+(?:has\s+been\s+)?(?:moved|removed|deleted)|(?:hmm|oops|whoops|yikes)[.,!]?\s+(?:we|something|this|page|sorry)/i;

function looksLikeNotFoundBody(body) {
  if (!body || typeof body !== "string") return false;

  const titleMatch = body.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].replace(/<[^>]+>/g, " ").trim();
    if (NOT_FOUND_RE.test(title)) return true;
    // Whole-title matches like "404", "Not Found", "404 Not Found".
    if (/^(?:404|not\s+found|404\s*[-—|:]?\s*not\s+found)\s*$/i.test(title)) return true;
  }

  // Scan first few h1 and h2 elements — some 404 templates put the
  // "Page Not Found" copy in h2, or have a hero h1 first and the error
  // message in a later heading.
  const headings = body.match(/<h[12]\b[^>]*>[\s\S]{0,500}?<\/h[12]>/gi) || [];
  for (const m of headings.slice(0, 6)) {
    const text = m.replace(/<[^>]+>/g, " ").trim();
    if (!text) continue;
    if (NOT_FOUND_RE.test(text)) return true;
    if (/^(?:404|not\s+found|oops!?|whoops!?)\s*$/i.test(text)) return true;
  }

  return false;
}

// Detect "404 redirects to homepage" — some retailers respond to dead
// product URLs by 302-ing to "/" instead of returning a real 404. The
// final URL after redirects is the homepage; the original asked for a
// specific product. That's a broken link from the user's perspective.
function redirectedToRoot(originalUrl, finalUrl) {
  try {
    const o = new URL(originalUrl);
    const f = new URL(finalUrl);
    if (o.hostname.toLowerCase().replace(/^www\./, "") !==
        f.hostname.toLowerCase().replace(/^www\./, "")) {
      return false;
    }
    const oPath = o.pathname.replace(/\/+$/, "");
    const fPath = f.pathname.replace(/\/+$/, "");
    return (fPath === "" || fPath === "/") && oPath !== "" && oPath !== "/";
  } catch (_) {
    return false;
  }
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
