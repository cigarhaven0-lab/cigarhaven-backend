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
  const mode = opts.mode || "broad";
  const excludeDomains = Array.isArray(opts.excludeDomains) ? opts.excludeDomains : [];

  const reminder =
    `Reminder: every URL must go to a SPECIFIC cigar product page, not a ` +
    `brand/category landing page. If you only have a brand URL, skip that listing.`;

  let userMessage;
  if (mode === "specialty") {
    userMessage =
      `Find current online cigar listings for: "${query}"\n\n` +
      `Focus this entire search on SPECIALTY / BOUTIQUE / REGIONAL cigar ` +
      `shops — NOT the major chains. Specifically avoid returning results ` +
      `from these big-chain domains:\n` +
      `  - jrcigars.com\n  - famous-smoke.com\n  - cigarsinternational.com\n` +
      `  - holts.com\n  - thompsoncigar.com\n  - cigar.com\n\n` +
      `Try retailers like (and similar):\n` +
      `  - smallbatchcigar.com\n  - mikescigars.com\n  - neptunecigar.com\n` +
      `  - cigarpage.com\n  - corona-cigar.com\n  - cigarsdirect.com\n` +
      `  - atlanticcigar.com\n  - bestcigarprices.com\n  - cuencacigars.com\n` +
      `  - watchcigar.com\n  - cigarpost.com\n  - bonita-smoke.com\n` +
      `  - Regional cigar shops (FL, TX, NY, NJ, CA, etc.)\n` +
      `  - Boutique / curated online cigar stores\n` +
      `  - Direct-from-manufacturer sites if applicable\n\n` +
      `Surface 15-30 listings from specialty retailers. Return the JSON ` +
      `array exactly as specified — your entire response must be the JSON ` +
      `array, nothing else.\n\n` + reminder;
  } else if (mode === "gapfill" && excludeDomains.length) {
    userMessage =
      `Find current online cigar listings for: "${query}"\n\n` +
      `We already have listings from these retailers, so DO NOT return ` +
      `more results from these domains — focus this entire search on OTHER ` +
      `retailers we haven't hit yet:\n` +
      excludeDomains.map((d) => `- ${d}`).join("\n") +
      `\n\nFind 10-25 listings from DIFFERENT retailers — anywhere a US ` +
      `customer can buy "${query}" cigars online that isn't in the list ` +
      `above. Dig past the first page of Google results. Try smaller ` +
      `regional retailers, niche specialty shops, and online-only stores.\n\n` +
      `Return the JSON array exactly as specified — your entire response ` +
      `must be the JSON array, nothing else.\n\n` + reminder;
  } else {
    userMessage =
      `Find current online cigar listings for: "${query}"\n\n` +
      `Search the open web. Surface 20-30 listings across as many distinct ` +
      `retailers as you can — variety matters. Return the JSON array ` +
      `exactly as specified — your entire response must be the JSON array, ` +
      `nothing else.\n\n` + reminder;
  }

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

  // Verify each URL actually resolves and pull in-stock status from the
  // page. Gemini sometimes constructs plausible URLs that 404 and almost
  // always guesses inStock=true, so we override both with what we
  // actually see on the page.
  const verifications = await Promise.all(
    prelim.map(async (it) => ({ item: it, v: await verifyUrl(it.url) }))
  );
  const cleaned = verifications
    .filter((r) => r.v.ok)
    .map((r) => ({
      ...r.item,
      inStock: r.v.inStock !== null && r.v.inStock !== undefined
        ? r.v.inStock
        : r.item.inStock,
    }));
  const droppedUrls = verifications.filter((r) => !r.v.ok).map((r) => r.item.url);

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

// Run three Gemini passes for maximum retailer coverage. Pass 1 (broad)
// and pass 2 (specialty/boutique, no big chains) run in parallel — they
// target disjoint parts of the retailer landscape, so there's no data
// dependency. Pass 3 (gapfill) runs sequentially after, told which
// domains 1+2 already covered, and goes hunting for anything still
// missing. Total latency ≈ 2 passes' worth (the parallel pair finishes
// first, then pass 3); total coverage ≈ 3 passes. Results deduped by
// canonical URL across all three.
async function searchThreePasses(query) {
  const [pass1, pass2] = await Promise.all([
    searchWithGemini(query, { mode: "broad" }),
    searchWithGemini(query, { mode: "specialty" }),
  ]);

  const seenDomains = uniqueDomains([...pass1.results, ...pass2.results]);
  const pass3 = await searchWithGemini(query, {
    mode: "gapfill",
    excludeDomains: seenDomains,
  });

  const merged = dedupeByUrl([...pass1.results, ...pass2.results, ...pass3.results]);

  const pass1Keys = new Set(pass1.results.map((it) => canonicalUrlKey(it.url)));
  const pass12Keys = new Set([
    ...pass1.results.map((it) => canonicalUrlKey(it.url)),
    ...pass2.results.map((it) => canonicalUrlKey(it.url)),
  ]);
  const newInPass2 = pass2.results.filter(
    (it) => !pass1Keys.has(canonicalUrlKey(it.url))
  ).length;
  const newInPass3 = pass3.results.filter(
    (it) => !pass12Keys.has(canonicalUrlKey(it.url))
  ).length;

  return {
    results: merged,
    debug: {
      model: pass1.debug.model,
      itemCountRaw:
        pass1.debug.itemCountRaw + pass2.debug.itemCountRaw + pass3.debug.itemCountRaw,
      itemCountClean: merged.length,
      itemCountFromPass1: pass1.results.length,
      itemCountFromPass2: pass2.results.length,
      itemCountFromPass3: pass3.results.length,
      itemCountNewInPass2: newInPass2,
      itemCountNewInPass3: newInPass3,
      pass1Domains: uniqueDomains(pass1.results),
      pass2Domains: uniqueDomains(pass2.results),
      pass3Domains: uniqueDomains(pass3.results),
      searchQueries: [
        ...(pass1.debug.searchQueries || []),
        ...(pass2.debug.searchQueries || []),
        ...(pass3.debug.searchQueries || []),
      ],
      sources: [
        ...(pass1.debug.sources || []),
        ...(pass2.debug.sources || []),
        ...(pass3.debug.sources || []),
      ],
      usage: {
        pass1: pass1.debug.usage,
        pass2: pass2.debug.usage,
        pass3: pass3.debug.usage,
      },
      droppedUrls: [
        ...(pass1.debug.droppedUrls || []),
        ...(pass2.debug.droppedUrls || []),
        ...(pass3.debug.droppedUrls || []),
      ],
      rawText:
        `--- PASS 1 (broad) ---\n${pass1.debug.rawText}\n\n` +
        `--- PASS 2 (specialty) ---\n${pass2.debug.rawText}\n\n` +
        `--- PASS 3 (gapfill) ---\n${pass3.debug.rawText}`,
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

// Verify a URL points to a real, specific product page and determine its
// in-stock status. Returns { ok, inStock } — ok=false drops the listing
// entirely; inStock is true / false / null where null means "no signal,
// fall back to whatever Gemini said". Drops the URL if:
//   - 4xx/5xx responses
//   - final URLs that look like /404, /not-found, /search?q=, etc.
//   - "soft 404" pages (HTTP 200 with "Page Not Found" in <title>/<h1>)
//   - category / listing / brand-landing pages (CollectionPage /
//     SearchResultsPage / og:type=website with many product cards) so
//     the user lands on a specific cigar, not a brand index
// GETs the first 128KB so JSON-LD blocks lower in <head> still get seen.
async function verifyUrl(url) {
  if (!url || typeof url !== "string") return { ok: false };
  if (urlLooksLikeSearchOrCategory(url)) return { ok: false };
  if (urlLooksLikeKnownNonProduct(url)) return { ok: false };

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

    if (resp.status < 200 || resp.status >= 400) return { ok: false };
    const finalUrl = resp.url || url;
    if (looksLikeNotFoundUrl(finalUrl)) return { ok: false };
    if (urlLooksLikeSearchOrCategory(finalUrl)) return { ok: false };
    if (urlLooksLikeKnownNonProduct(finalUrl)) return { ok: false };
    if (redirectedToRoot(url, finalUrl)) return { ok: false };

    let body = "";
    try {
      body = await resp.text();
    } catch (_) {
      // Status was OK but body couldn't be read — accept rather than
      // drop a potentially good listing.
      return { ok: true, inStock: null };
    }
    if (looksLikeNotFoundBody(body)) return { ok: false };
    if (looksLikeListingPage(body)) return { ok: false };
    if (h1LooksLikeBrandListing(body)) return { ok: false };
    return { ok: true, inStock: determineInStock(body) };
  } catch (_) {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// Determine in-stock status from the actual page body. Prefers
// Schema.org Offer.availability — the standard product-page signal —
// and falls back to scanning for "out of stock" / "sold out" /
// "currently unavailable" / "notify me when available" markers. Returns
// true (in stock), false (out of stock), or null (no signal — caller
// keeps whatever Gemini said). With multiple Offer variants, any single
// in-stock variant wins, since the listing is still partially buyable.
function determineInStock(body) {
  if (!body || typeof body !== "string") return null;

  // Schema.org availability — used by most modern e-commerce
  const availabilityMatches =
    body.match(/"availability"\s*:\s*"([^"]+)"/gi) || [];
  let sawInStock = false;
  let sawOutOfStock = false;
  for (const m of availabilityMatches) {
    const raw = (m.match(/"availability"\s*:\s*"([^"]+)"/i) || [])[1] || "";
    const norm = raw.toLowerCase().replace(/^https?:\/\/schema\.org\//, "").trim();
    if (/outofstock|discontinued|soldout|backorder/.test(norm)) sawOutOfStock = true;
    if (/instock|onlineonly|limitedavailability|instoreonly|preorder/.test(norm)) sawInStock = true;
  }
  if (sawInStock) return true;
  if (sawOutOfStock) return false;

  // Body-text fallback for sites without JSON-LD availability
  if (/\bout\s+of\s+stock\b|\bsold\s+out\b|\bcurrently\s+unavailable\b|\bnotify\s+me\s+when\s+(?:this\s+is\s+)?(?:available|back\s+in\s+stock)\b|\btemporarily\s+(?:out\s+of\s+stock|unavailable)\b/i.test(body)) {
    return false;
  }

  return null;
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

// Per-retailer URL shapes we know are NOT product pages. This is a
// blacklist (drop URLs matching these) rather than a whitelist (only
// allow these), because retailers often have several product-URL
// shapes — listing them all is impossible and a whitelist would drop
// real products that happen to use a shape we haven't catalogued.
// What we DO know reliably is which paths are categories / brand
// indexes / known error pages. Drop only those.
const RETAILER_NON_PRODUCT_PATTERNS = {
  // JR Cigars: category paths live under /cigars/..., brand indexes are
  // single-segment slugs ending in -cigars (e.g. /padron-cigars), and
  // /not_found is the explicit 404 page. Everything else (including
  // /item/.../*.html, /<sku>, /<product-slug>, etc.) we let through and
  // rely on the page-content checks to validate.
  "jrcigars.com": [
    /^\/cigars(?:\/|$)/i,
    /^\/[\w-]+-cigars?\/?$/i,
    /^\/not_?found(?:\/|$)/i,
  ],
};

function urlLooksLikeKnownNonProduct(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const patterns = RETAILER_NON_PRODUCT_PATTERNS[host];
    if (!patterns) return false;
    return patterns.some((p) => p.test(u.pathname));
  } catch (_) {
    return false;
  }
}

// Brand-landing page detection: real cigar product page h1s are the
// specific product name ("Padron 1964 Anniversary No. 4 5-Pack"). Brand
// listing h1s are just "<Brand> Cigars" with a short brand name in
// front. Only fires when BOTH (a) the h1 matches the "<short> Cigars"
// pattern AND (b) the page contains multiple Product schemas — so a
// real product page that happens to be called "Caldwell Sampler Cigars"
// (which would have a single Product schema) survives.
function h1LooksLikeBrandListing(body) {
  if (!body || typeof body !== "string") return false;
  const h1Match = body.match(/<h1\b[^>]*>([\s\S]{0,200}?)<\/h1>/i);
  if (!h1Match) return false;
  const h1 = h1Match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!/\s+cigars?$/i.test(h1)) return false;
  const stem = h1.replace(/\s+cigars?$/i, "").trim();
  if (!stem) return false;
  const wordCount = stem.split(/\s+/).filter(Boolean).length;
  if (wordCount > 3) return false;
  // Confirming signal: multiple Product cards = actually a listing
  const productCount = (body.match(/"@type"\s*:\s*"Product"/gi) || []).length;
  return productCount >= 3;
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
  /page\s+not\s+found|404\s+not\s+found|not\s+found\s*[-—|:]\s*404|404\s+error|error\s+404|404\s*[-—|:]\s*(?:not\s+found|error|page)|page\s+(?:doesn'?t|does\s+not)\s+exist|(?:we|you|i)\s+(?:can'?t|cannot|couldn'?t|could\s+not)\s+find|sorry,?\s+(?:we\s+)?(?:can'?t|cannot|couldn'?t|could\s+not)\s+find|(?:the\s+)?(?:page|product|cigar|item|what)\s+you'?re\s+looking\s+for|(?:product|item|listing)\s+(?:is\s+)?(?:not\s+found|unavailable|no\s+longer\s+available)|this\s+page\s+(?:is\s+)?(?:no\s+longer\s+)?(?:available|unavailable)|page\s+(?:has\s+been\s+)?(?:moved|removed|deleted)|(?:hmm|oops|whoops|yikes)[.,!]?\s+(?:we|something|this|page|sorry)/i;

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
    const { results, debug } = await searchThreePasses(query);
    const sorted = sortByPrice(results);
    const byStore = sorted.reduce((acc, r) => ((acc[r.store] = (acc[r.store] || 0) + 1), acc), {});
    console.log(
      `[search] returned ${sorted.length} results ` +
        `(pass1=${debug.itemCountFromPass1}, pass2=${debug.itemCountFromPass2}, ` +
        `pass3=${debug.itemCountFromPass3}, ` +
        `newInPass2=${debug.itemCountNewInPass2}, ` +
        `newInPass3=${debug.itemCountNewInPass3}, ` +
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
    const { results, debug } = await searchThreePasses(query);
    const byStore = results.reduce((acc, r) => ((acc[r.store] = (acc[r.store] || 0) + 1), acc), {});
    res.json({
      query,
      model: debug.model,
      itemCountRaw: debug.itemCountRaw,
      itemCountClean: debug.itemCountClean,
      itemCountFromPass1: debug.itemCountFromPass1,
      itemCountFromPass2: debug.itemCountFromPass2,
      itemCountFromPass3: debug.itemCountFromPass3,
      itemCountNewInPass2: debug.itemCountNewInPass2,
      itemCountNewInPass3: debug.itemCountNewInPass3,
      pass1Domains: debug.pass1Domains,
      pass2Domains: debug.pass2Domains,
      pass3Domains: debug.pass3Domains,
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
