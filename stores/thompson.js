/**
 * thompson.js — Thompson Cigar scraper
 */

const https = require("https");
const { queryTerms, matchesQuery, normalize, extractPrice } = require("./scraper");

const BRAND_URLS = {
  padron:      "https://www.thompsoncigar.com/category/all-cigar-brands/padron/",
  montecristo: "https://www.thompsoncigar.com/category/all-cigar-brands/montecristo/",
  arturo:      "https://www.thompsoncigar.com/category/all-cigar-brands/arturo-fuente/",
  fuente:      "https://www.thompsoncigar.com/category/all-cigar-brands/arturo-fuente/",
  cohiba:      "https://www.thompsoncigar.com/category/all-cigar-brands/cohiba/",
  romeo:       "https://www.thompsoncigar.com/category/all-cigar-brands/romeo-y-julieta/",
  julieta:     "https://www.thompsoncigar.com/category/all-cigar-brands/romeo-y-julieta/",
  macanudo:    "https://www.thompsoncigar.com/category/all-cigar-brands/macanudo/",
  davidoff:    "https://www.thompsoncigar.com/category/all-cigar-brands/davidoff/",
  oliva:       "https://www.thompsoncigar.com/category/all-cigar-brands/oliva/",
  rocky:       "https://www.thompsoncigar.com/category/all-cigar-brands/rocky-patel/",
  patel:       "https://www.thompsoncigar.com/category/all-cigar-brands/rocky-patel/",
  ashton:      "https://www.thompsoncigar.com/category/all-cigar-brands/ashton/",
  punch:       "https://www.thompsoncigar.com/category/all-cigar-brands/punch/",
  cao:         "https://www.thompsoncigar.com/category/all-cigar-brands/cao/",
};

const BAD_NAMES = new Set([
  "shop now", "add to cart", "subscribe & save", "write a review", "quick view", "wishlist", "compare",
]);

function getThompsonUrl(query) {
  const q = query.toLowerCase();
  for (const [keyword, url] of Object.entries(BRAND_URLS)) {
    if (q.includes(keyword)) return url;
  }
  return `https://www.thompsoncigar.com/search?q=${encodeURIComponent(query)}`;
}

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
    };
    const req = https.get(url, options, (res) => {
      console.log(`[Thompson] HTTP status: ${res.statusCode}`);
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, html: data }));
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function searchThompson(query) {
  const url = getThompsonUrl(query);
  const terms = queryTerms(query);

  console.log(`[Thompson] scraping: ${url}`);

  try {
    const { status, html } = await fetchHTML(url);
    console.log(`[Thompson] got ${html.length} bytes, status ${status}`);
    console.log(`[Thompson] body snippet: ${html.slice(0, 400).replace(/\s+/g, " ")}`);

    if (status !== 200) {
      console.log(`[Thompson] blocked with status ${status}`);
      return [];
    }

    const cheerio = require("cheerio");
    const $ = cheerio.load(html);

    console.log(`[Thompson] page title: ${$("title").text()}`);

    const productLinks = $("a[href*='/product/'], a[href*='/p/']");
    console.log(`[Thompson] product links found: ${productLinks.length}`);

    const seen = new Set();
    const products = [];

    productLinks.each((_, el) => {
      if (products.length >= 10) return false;

      let href = $(el).attr("href") || "";
      if (href.startsWith("/")) href = "https://www.thompsoncigar.com" + href;
      if (seen.has(href)) return;

      const name = normalize($(el).text());
      if (!name || name.length < 4 || BAD_NAMES.has(name.toLowerCase())) return;

      const container = $(el).closest("li, article, div.product, div[class*='product']");
      const containerText = normalize(container.text() || $(el).parent().parent().text());

      if (!matchesQuery(name + " " + containerText, terms)) return;

      const price = extractPrice(containerText);
      if (!price) return;

      const packMatch = containerText.match(/(Box of \d+|Pack of \d+|Single|Bundle of \d+|Sampler)/i);

      seen.add(href);
      products.push({
        store: "Thompson Cigars",
        name,
        price,
        url: href,
        pack: packMatch ? packMatch[1] : "N/A",
        inStock: /in stock/i.test(containerText) ? true : !/out of stock|sold out/i.test(containerText),
        lastChecked: new Date().toLocaleString(),
        sourceType: "live",
      });
    });

    console.log(`[Thompson] found ${products.length} products`);
    return products;
  } catch (err) {
    console.error("[Thompson] failed:", err.message);
    return [];
  }
}

module.exports = searchThompson;
