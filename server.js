/**
 * Cigar Haven Backend — Gemini + Google Search grounding.
 *
 * Required env: GEMINI_API_KEY  (free key from https://aistudio.google.com)
 * Optional env: GEMINI_MODEL    (default: gemini-2.5-flash)
 */

const express = require("express");
const cors = require("cors");

// CommonJS interop — handles ESM default export across SDK versions
const genaiMod = require("@google/genai");
const GoogleGenAI = genaiMod.GoogleGenAI || genaiMod.default || genaiMod;

const app = express();
app.use(cors());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const ALLOWED_DOMAINS = [
  "jrcigars.com",
  "thompsoncigar.com",
  "cigarsinternational.com",
];

const SYSTEM_PROMPT = `You are the search backend for "Cigar Haven", a cigar price comparison site.

Given a cigar brand or product query, use Google Search to find current product listings from these three online retailers:
  1. JR Cigars (jrcigars.com)
  2. Thompson Cigars (thompsoncigar.com)
  3. Cigars International (cigarsinternational.com)

Try to find listings from all three retailers when possible. Aim for 3-6 products per retailer where they exist. Use targeted searches like "padron cigars site:jrcigars.com" to find products on each retailer.

Your final response MUST be ONLY a JSON array — no prose, no preamble, no markdown code fences, no commentary. Just the raw JSON array. The first character of your response must be '[' and the last must be ']'.

Each item in the array MUST have this exact shape:
{
  "store": "JR Cigars" | "Thompson Cigars" | "Cigars International",
  "name": "<full product name as listed>",
  "price": "$<number>",
  "url": "<full https URL of the actual product page on that retailer's domain>",
  "pack": "<e.g. 'Box of 20', 'Single', 'Bundle of 25', '5 Pack', or 'N/A'>",
  "inStock": true | false
}

Hard rules:
- Output JSON ONLY. No prose before or after. No code fences.
- Only include listings you actually found via Google Search. Never invent products, prices, or URLs.
- "price" must start with "$" followed by a number (e.g. "$24.99", "$189").
- "url" must be a real product URL on one of the three allowed retailer domains. Do not include category page URLs.
- If a retailer has no matching results, simply omit it.
- If you cannot find any results across all three retailers, return an empty array: []
- Set "inStock" to false ONLY if the listing explicitly says "out of stock" or "sold out". Otherwise true.`;

async function searchWithGemini(query) {
  const userMessage =
    `Find current product listings for: "${query}"\n\n` +
    `Search jrcigars.com, thompsoncigar.com, and cigarsinternational.com. ` +
    `Return the JSON array exactly as specified — your entire response must ` +
    `be the JSON array, nothing else.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: userMessage,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ googleSearch: {} }],
      temperature: 0.2,
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
  const cleaned = items.filter(isValidItem).map((it) => ({
    store: String(it.store).trim(),
    name: String(it.name).trim(),
    price: String(it.price).trim(),
    url: String(it.url).trim(),
    pack: it.pack ? String(it.pack).trim() : "N/A",
    inStock: it.inStock !== false,
    lastChecked: now,
    sourceType: "ai",
  }));

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
    },
  };
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

function isValidItem(it) {
  if (!it || typeof it !== "object") return false;
  if (!it.store || !it.name || !it.price || !it.url) return false;
  if (typeof it.price !== "string" || !it.price.includes("$")) return false;
  if (typeof it.url !== "string" || !/^https?:\/\//i.test(it.url)) return false;
  if (!ALLOWED_DOMAINS.some((d) => it.url.toLowerCase().includes(d))) return false;
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
  res.send("Cigar Haven Backend running ✅ (Gemini + Google Search)");
});

app.get("/search", async (req, res) => {
  const query = (req.query.q || "").toString().trim();
  if (!query) return res.json({ error: "No search query provided" });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not set on the server" });
  }

  console.log(`[search] query: "${query}" model=${MODEL}`);
  try {
    const { results, debug } = await searchWithGemini(query);
    const sorted = sortByPrice(results);
    console.log(
      `[search] returned ${sorted.length} results ` +
        `(raw ${debug.itemCountRaw}, searches=${debug.searchQueries.length})`
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
    const { results, debug } = await searchWithGemini(query);
    res.json({
      query,
      model: debug.model,
      itemCountRaw: debug.itemCountRaw,
      itemCountClean: debug.itemCountClean,
      searchQueries: debug.searchQueries,
      sources: debug.sources,
      usage: debug.usage,
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
