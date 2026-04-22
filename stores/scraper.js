/**
 * scraper.js - Shared utilities + Browserless.io proxy
 *
 * Uses Browserless.io (browserless.io) as a cloud browser to bypass
 * bot protection like Incapsula/Cloudflare. Set BROWSERLESS_TOKEN
 * environment variable in Render.
 *
 * Free tier: 1,000 units/month
 */

const https = require("https");

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || "";
const BROWSERLESS_HOST = process.env.BROWSERLESS_HOST || "production-sfo.browserless.io";

/**
 * Fetch a page via Browserless's /content endpoint, which returns the
 * fully-rendered HTML after JavaScript has executed. This bypasses
 * anti-bot challenges that only return shell HTML to simple fetches.
 */
function fetchRenderedHTML(url, { waitForSelector = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!BROWSERLESS_TOKEN) {
      return reject(new Error("BROWSERLESS_TOKEN env variable not set"));
    }

    const payload = JSON.stringify({
      url,
      gotoOptions: {
        waitUntil: "networkidle2",
        timeout: timeout,
      },
      ...(waitForSelector ? { waitForSelector: { selector: waitForSelector, timeout: 10000 } } : {}),
      // Give the page time to run anti-bot challenges and settle
      waitForTimeout: 3000,
      // Use a realistic user agent
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      bestAttempt: true,
    });

    const options = {
      hostname: BROWSERLESS_HOST,
      path: `/content?token=${BROWSERLESS_TOKEN}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Cache-Control": "no-cache",
      },
      timeout: timeout + 10000,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        console.log(`[browserless] status ${res.statusCode} for ${url}`);
        if (res.statusCode !== 200) {
          console.log(`[browserless] error response: ${data.slice(0, 300)}`);
        }
        resolve({ status: res.statusCode, html: data });
      });
    });

    req.on("error", (err) => {
      console.error(`[browserless] request error: ${err.message}`);
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("browserless timeout"));
    });

    req.write(payload);
    req.end();
  });
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

module.exports = { fetchRenderedHTML, normalize, extractPrice, queryTerms, matchesQuery };
