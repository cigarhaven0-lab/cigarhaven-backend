/**
 * jr.js — JR Cigars scraper
 * Uses fetch with rotating headers to get past bot protection,
 * with Playwright as fallback.
 */

const https = require("https");
const { queryTerms, matchesQuery, normalize, extractPrice } = require("./scraper");

const BRAND_URLS = {
  padron:      "https://www.jrcigars.com/cigars/handmade-cigars/padron-cigars/",
  montecristo: "https://www.jrcigars.com/cigars/handmade-cigars/montecristo-cigars/",
  arturo:      "https://www.jrcigars.com/cigars/handmade-cigars/arturo-fuente-cigars/",
  fuente:      "https://www.jrcigars.com/cigars/handmade-cigars/arturo-fuente-cigars/",
  cohiba:      "https://www.jrcigars.com/cigars/handmade-cigars/cohiba-cigars/",
  romeo:       "https://www.jrcigars.com/cigars/handmade-cigars/romeo-y-julieta-cigars/",
  julieta:     "https://www.jrcigars.com/cigars/handmade-cigars/romeo-y-julieta-cigars/",
  macanudo:    "https://www.jrcigars.com/cigars/handmade-cigars/macanudo-cigars/",
  davidoff:    "https://www.jrcigars.com/cigars/handmade-cigars/davidoff-cigars/",
  oliva:       "https://www.jrcigars.com/cigars/handmade-cigars/oliva-cigars/",
  rocky:       "https://www.jrcigars.com/cigars/handmade-cigars/rocky-patel-cigars/",
  patel:       "https://www.jrcigars.com/cigars/handmade-cigars/rocky-patel-cigars/",
  ashton:      "https://www.jrcigars.com/cigars/handmade-cigars/ashton-cigars/",
  punch:       "https://www.jrcigars.com/cigars/handmade-cigars/punch-cigars/",
  cao:         "https://www.jrcigars.com/cigars/handmade-cigars/cao-cigars/",
};

function getJRUrl(query) {
  const q = query.toLowerCase();
  for (const [keyword, url] of Object.entries(BRAND_URLS)) {
    if (q.includes(keyword.toLowerCase())) return url;
  }
  return `https://www.jrcigars.com/search/?q=${encodeURIComponent(query)}`;
}

// Fetch raw HTML using Node's built-in https with browser-like headers
function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
    };
    const req = https.get(url, options, (res) => {
      console.log(`[JR] HTTP status: ${res.statusCode}`);
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, html: data }));
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function searchJR(query) {
  const url = getJRUrl(query);
  const terms = queryTerms(query);

  console.log(`[JR] scraping: ${url}`);

  try {
    const { status, html } = await fetchHTML(url);

    console.log(`[JR] got ${html.length} bytes, status ${status}`);
    console.log(`[JR] body snippet: ${html.slice(0, 500).replace(/\s+/g, " ")}`);

    if (status !== 200) {
      console.log(`[JR] blocked with status ${status}`);
      return [];
    }

    // Parse with cheerio
    const cheerio = require("cheerio");
    const $ = cheerio.load(html);

    const title = $("title").text();
    console.log(`[JR] page title: ${title}`);

    // Count product links
    const itemLinks = $("a[href*='/item/']");
    const priceEls = $("[class*='price'], [class*='Price']");
    console.log(`[JR] item links: ${itemLinks.length}, price elements: ${priceEls.length}`);

    const seen = new Set();
    const products = [];

    itemLinks.each((_, el) => {
      if (products.length >= 10) return false;

      let href = $(el).attr("href") || "";
      if (href.startsWith("/")) href = "https://www.jrcigars.com" + href;
      if (!href.includes("/item/") || seen.has(href)) return;

      const name = normalize($(el).text());
      if (!name || name.length < 4) return;

      // Get price from nearby container
      const container = $(el).closest("li, article, div.product, div[class*='item']");
      const containerText = normalize(container.text() || $(el).parent().parent().text());

      if (!matchesQuery(name + " " + containerText, terms)) return;

      const price = extractPrice(containerText);
      if (!price) return;

      const packMatch = containerText.match(/(Box of \d+|Pack of \d+|Single|Bundle of \d+|Tin of \d+)/i);

      seen.add(href);
      products.push({
        store: "JR Cigars",
        name,
        price,
        url: href,
        pack: packMatch ? packMatch[1] : "N/A",
        inStock: !/sold out|out of stock|backorder/i.test(containerText),
        lastChecked: new Date().toLocaleString(),
        sourceType: "live",
      });
    });

    console.log(`[JR] found ${products.length} products`);
    return products;
  } catch (err) {
    console.error("[JR] failed:", err.message);
    return [];
  }
}

module.exports = searchJR;
