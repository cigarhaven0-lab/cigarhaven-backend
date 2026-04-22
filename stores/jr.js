/**
 * jr.js — JR Cigars scraper via Browserless.io
 */

const { fetchRenderedHTML, queryTerms, matchesQuery, normalize, extractPrice } = require("./scraper");
const cheerio = require("cheerio");

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

async function searchJR(query) {
  const url = getJRUrl(query);
  const terms = queryTerms(query);

  console.log(`[JR] scraping: ${url}`);

  try {
    const { status, html } = await fetchRenderedHTML(url, {
      waitForSelector: "a[href*='/item/']",
      timeout: 30000,
    });

    console.log(`[JR] got ${html.length} bytes, status ${status}`);

    if (status !== 200 || html.length < 1000) {
      console.log(`[JR] unusable response, status=${status} len=${html.length}`);
      return [];
    }

    const $ = cheerio.load(html);
    console.log(`[JR] page title: ${$("title").text().slice(0, 60)}`);

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

      const container = $(el).closest("li, article, div.product, div[class*='item'], div[class*='Product']");
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
