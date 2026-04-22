/**
 * scraper.js - Shared Playwright utility with Render.com compatibility
 * and extensive logging to diagnose bot-blocking issues.
 */

const { chromium } = require("playwright");

const STEALTH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Ch-Ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

async function openPage(url, { waitForSelector = null, timeout = 45000 } = {}) {
  console.log(`[scraper] launching browser for: ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
    ],
  });

  const context = await browser.newContext({
    userAgent: STEALTH_HEADERS["User-Agent"],
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    extraHTTPHeaders: STEALTH_HEADERS,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  // Log HTTP response status so we can see if we're getting blocked
  page.on("response", response => {
    if (response.url() === url || response.request().resourceType() === "document") {
      console.log(`[scraper] HTTP ${response.status()} for ${response.url().slice(0, 80)}`);
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {});
  }

  await page.waitForTimeout(2000);

  // Log page title and body snippet so we can see what we got
  const title = await page.title().catch(() => "unknown");
  const bodySnippet = await page.evaluate(() =>
    document.body ? document.body.innerText.slice(0, 300) : "no body"
  ).catch(() => "eval failed");

  console.log(`[scraper] page title: "${title}"`);
  console.log(`[scraper] body snippet: ${bodySnippet.replace(/\n/g, " ").slice(0, 200)}`);

  const closeBrowser = async () => {
    try { await browser.close(); } catch {}
  };

  return { page, closeBrowser };
}

function normalize(str) {
  return String(str || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function extractPrice(text) {
  const match = text.match(/\$\s*(\d{1,4}(?:\.\d{2})?)/);
  return match ? `$${match[1]}` : null;
}

function queryTerms(query) {
  const q = query.toLowerCase().trim();
  if (q.includes("arturo") || q.includes("fuente")) return ["arturo", "fuente"];
  if (q.includes("romeo") || q.includes("julieta")) return ["romeo", "julieta"];
  return q.split(/\s+/).filter(w => w.length > 1);
}

function matchesQuery(text, terms) {
  const t = text.toLowerCase();
  return terms.some(term => t.includes(term));
}

module.exports = { openPage, normalize, extractPrice, queryTerms, matchesQuery };
