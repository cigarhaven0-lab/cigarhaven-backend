/**
 * scraper.js
 * Shared Playwright browser utility.
 * Launches a single stealth-configured Chromium instance reused across scrapes.
 */

const { chromium } = require("playwright");

// Stealth headers that mimic a real Chrome browser
const STEALTH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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

/**
 * Open a stealth Playwright page, navigate to a URL, wait for content,
 * then return the page handle for scraping.
 * Caller is responsible for closing the browser via the returned closeBrowser().
 */
async function openPage(url, { waitForSelector = null, timeout = 45000 } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1366,768",
    ],
  });

  const context = await browser.newContext({
    userAgent: STEALTH_HEADERS["User-Agent"],
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    extraHTTPHeaders: STEALTH_HEADERS,
  });

  // Hide webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = await context.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded", timeout });

  // Wait for network to settle
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  // Optionally wait for a specific selector
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {});
  }

  // Small human-like pause
  await page.waitForTimeout(1500);

  const closeBrowser = async () => {
    try { await browser.close(); } catch {}
  };

  return { page, closeBrowser };
}

/**
 * Normalize whitespace and non-breaking spaces in a string.
 */
function normalize(str) {
  return String(str || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the first dollar price from a string.
 * Returns e.g. "$12.99" or null.
 */
function extractPrice(text) {
  const match = text.match(/\$\s*(\d{1,4}(?:\.\d{2})?)/);
  return match ? `$${match[1]}` : null;
}

/**
 * Build search terms from a query string.
 */
function queryTerms(query) {
  const q = query.toLowerCase().trim();
  // Special multi-word brand mappings
  if (q.includes("arturo") || q.includes("fuente")) return ["arturo", "fuente"];
  if (q.includes("romeo") || q.includes("julieta")) return ["romeo", "julieta"];
  if (q.includes("macanudo")) return ["macanudo"];
  return q.split(/\s+/).filter(w => w.length > 1);
}

/**
 * Check if a product name/text matches the search terms.
 */
function matchesQuery(text, terms) {
  const t = text.toLowerCase();
  return terms.some(term => t.includes(term));
}

module.exports = { openPage, normalize, extractPrice, queryTerms, matchesQuery };
