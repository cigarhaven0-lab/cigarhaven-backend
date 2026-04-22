/**
 * thompson.js — Thompson Cigar scraper
 * Uses Playwright to handle JS-rendered pages and Cloudflare protection.
 */

const { openPage, normalize, extractPrice, queryTerms, matchesQuery } = require("./scraper");

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
  "shop now", "add to cart", "subscribe & save", "write a review",
  "quick view", "wishlist", "compare",
]);

function getThompsonUrl(query) {
  const q = query.toLowerCase();
  for (const [keyword, url] of Object.entries(BRAND_URLS)) {
    if (q.includes(keyword)) return url;
  }
  return `https://www.thompsoncigar.com/search?q=${encodeURIComponent(query)}`;
}

async function searchThompson(query) {
  const url = getThompsonUrl(query);
  const terms = queryTerms(query);
  let closeBrowser;

  console.log(`[Thompson] scraping: ${url}`);

  try {
    const result = await openPage(url, { timeout: 50000 });
    const page = result.page;
    closeBrowser = result.closeBrowser;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(1200);

    const items = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      // Only grab links to individual product pages
      const anchors = Array.from(document.querySelectorAll("a[href]")).filter(a => {
        const href = a.href || "";
        return href.includes("/product/") || href.includes("/p/");
      });

      for (const anchor of anchors) {
        const href = anchor.href || "";
        if (!href) continue;

        // Skip links that are just the category root
        if (href.endsWith("/category/") || href.split("/").filter(Boolean).length < 4) continue;
        if (seen.has(href)) continue;
        seen.add(href);

        const name = (anchor.innerText || anchor.textContent || "").trim();

        // Walk up to product card
        let card = anchor;
        for (let i = 0; i < 6; i++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          if (["LI", "ARTICLE"].includes(card.tagName)) break;
          if (card.tagName === "DIV" && (card.innerText || "").includes("$")) break;
        }

        const cardText = card ? (card.innerText || "") : "";
        results.push({ href, name, cardText });
      }

      return results;
    });

    const seen = new Set();
    const products = [];

    for (const item of items) {
      if (products.length >= 10) break;
      if (seen.has(item.href)) continue;

      const name = normalize(item.name);
      if (!name || name.length < 4) continue;
      if (BAD_NAMES.has(name.toLowerCase())) continue;
      if (!matchesQuery(name + " " + item.cardText, terms)) continue;

      const price = extractPrice(item.cardText);
      if (!price) continue;

      const packMatch = item.cardText.match(
        /(Box of \d+|Pack of \d+|Single|Bundle of \d+|Sampler|Cedar Chest of \d+)/i
      );

      seen.add(item.href);

      products.push({
        store: "Thompson Cigars",
        name,
        price,
        url: item.href,   // direct product page URL
        pack: packMatch ? packMatch[1] : "N/A",
        inStock: /in stock/i.test(item.cardText)
          ? true
          : !/out of stock|sold out/i.test(item.cardText),
        lastChecked: new Date().toLocaleString(),
        sourceType: "live",
      });
    }

    console.log(`[Thompson] found ${products.length} products`);
    return products;
  } catch (err) {
    console.error("[Thompson] scraper failed:", err.message);
    return [];
  } finally {
    if (closeBrowser) await closeBrowser();
  }
}

module.exports = searchThompson;
