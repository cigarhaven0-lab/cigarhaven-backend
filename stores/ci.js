/**
 * ci.js — Cigars International via Browserless.io
 */

const { fetchRenderedHTML, queryTerms, matchesQuery, normalize, extractPrice } = require("./scraper");
const cheerio = require("cheerio");

const BRAND_URLS = {
  padron:      "https://www.cigarsinternational.com/shop/padron-cigars/1701404/",
  montecristo: "https://www.cigarsinternational.com/shop/montecristo-cigars/1701371/",
  arturo:      "https://www.cigarsinternational.com/shop/arturo-fuente-cigars/1701026/",
  fuente:      "https://www.cigarsinternational.com/shop/arturo-fuente-cigars/1701026/",
  cohiba:      "https://www.cigarsinternational.com/shop/cohiba-cigars/1701128/",
  romeo:       "https://www.cigarsinternational.com/shop/romeo-y-julieta-cigars/1701467/",
  julieta:     "https://www.cigarsinternational.com/shop/romeo-y-julieta-cigars/1701467/",
  macanudo:    "https://www.cigarsinternational.com/shop/macanudo-cigars/1701346/",
  davidoff:    "https://www.cigarsinternational.com/shop/davidoff-cigars/1701155/",
  oliva:       "https://www.cigarsinternational.com/shop/oliva-cigars/1701397/",
  rocky:       "https://www.cigarsinternational.com/shop/rocky-patel-cigars/1701466/",
  patel:       "https://www.cigarsinternational.com/shop/rocky-patel-cigars/1701466/",
  ashton:      "https://www.cigarsinternational.com/shop/ashton-cigars/1701028/",
  punch:       "https://www.cigarsinternational.com/shop/punch-cigars/1701446/",
  cao:         "https://www.cigarsinternational.com/shop/cao-cigars/1701086/",
};

const BAD_NAMES = new Set([
  "shop now", "login", "register", "my account", "cart", "help",
  "request a catalog", "receive email specials", "sign in",
]);

function getCIUrl(query) {
  const q = query.toLowerCase();
  for (const [keyword, url] of Object.entries(BRAND_URLS)) {
    if (q.includes(keyword)) return url;
  }
  return `https://www.cigarsinternational.com/search/?q=${encodeURIComponent(query)}`;
}

async function searchCI(query) {
  const url = getCIUrl(query);
  const terms = queryTerms(query);

  console.log(`[CI] scraping: ${url}`);

  try {
    const { status, html } = await fetchRenderedHTML(url, { timeout: 30000 });
    console.log(`[CI] got ${html.length} bytes, status ${status}`);

    if (status !== 200 || html.length < 1000) {
      console.log(`[CI] unusable response`);
      return [];
    }

    const $ = cheerio.load(html);
    console.log(`[CI] page title: ${$("title").text().slice(0, 60)}`);

    const productLinks = $("a[href*='/p/']").filter((_, el) => /\/p\/[a-zA-Z0-9\-_]+/.test($(el).attr("href") || ""));
    console.log(`[CI] product links: ${productLinks.length}`);

    const seen = new Set();
    const products = [];

    productLinks.each((_, el) => {
      if (products.length >= 10) return false;

      let href = $(el).attr("href") || "";
      if (href.startsWith("/")) href = "https://www.cigarsinternational.com" + href;
      if (seen.has(href)) return;

      const name = normalize($(el).text());
      if (!name || name.length < 4 || BAD_NAMES.has(name.toLowerCase())) return;

      const container = $(el).closest("li, article, div[class*='product'], div[class*='item']");
      const containerText = normalize(container.text() || $(el).parent().parent().text());

      if (!matchesQuery(name + " " + containerText, terms)) return;

      const asLowMatch = containerText.match(/as low as\s+\$(\d+(?:\.\d{2})?)/i);
      const price = asLowMatch ? `$${asLowMatch[1]}` : extractPrice(containerText);
      if (!price) return;

      const packMatch = containerText.match(/(Box of \d+|Pack of \d+|Single|Bundle of \d+|Tins? of \d+|Sampler)/i);

      seen.add(href);
      products.push({
        store: "Cigars International",
        name,
        price,
        url: href,
        pack: packMatch ? packMatch[1] : "N/A",
        inStock: !/out of stock|sold out/i.test(containerText),
        lastChecked: new Date().toLocaleString(),
        sourceType: "live",
      });
    });

    console.log(`[CI] found ${products.length} products`);
    return products;
  } catch (err) {
    console.error("[CI] failed:", err.message);
    return [];
  }
}

module.exports = searchCI;
