/**
 * ci.js — Cigars International scraper with detailed logging
 */

const { openPage, normalize, extractPrice, queryTerms, matchesQuery } = require("./scraper");

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

const BAD_ANCHOR_TEXT = new Set([
  "shop now", "login", "register", "my account", "cart",
  "help", "request a catalog", "receive email specials", "sign in",
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
  let closeBrowser;

  console.log(`[CI] scraping: ${url}`);

  try {
    const result = await openPage(url, { timeout: 55000 });
    const page = result.page;
    closeBrowser = result.closeBrowser;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(2000);

    const diagnostics = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll("a[href]"));
      const productLinks = allLinks.filter(a => /\/p\/[a-zA-Z0-9\-_]+/.test(a.href));
      const priceEls = document.querySelectorAll("[class*='price'], [class*='Price']");
      return {
        totalLinks: allLinks.length,
        productLinks: productLinks.length,
        priceElements: priceEls.length,
        sampleProductLinks: productLinks.slice(0, 3).map(a => ({ href: a.href, text: a.innerText.trim().slice(0, 50) })),
      };
    });

    console.log(`[CI] diagnostics:`, JSON.stringify(diagnostics));

    const items = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      const anchors = Array.from(document.querySelectorAll("a[href*='/p/']")).filter(a => {
        return /\/p\/[a-zA-Z0-9\-_]+/.test(a.href || "");
      });

      for (const anchor of anchors) {
        const href = anchor.href || "";
        if (!href || seen.has(href)) continue;
        seen.add(href);

        const name = (anchor.innerText || anchor.textContent || "").trim();
        if (name.length < 4) continue;

        let card = anchor;
        for (let i = 0; i < 7; i++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          if (card.innerText && card.innerText.includes("$")) break;
        }

        const cardText = card ? (card.innerText || "") : "";
        results.push({ href, name, cardText });
      }

      return results;
    });

    console.log(`[CI] raw items found: ${items.length}`);

    const seen = new Set();
    const products = [];

    for (const item of items) {
      if (products.length >= 10) break;
      if (seen.has(item.href)) continue;

      const name = normalize(item.name);
      if (!name || name.length < 4) continue;
      if (BAD_ANCHOR_TEXT.has(name.toLowerCase())) continue;
      if (!matchesQuery(name + " " + item.cardText, terms)) continue;

      const price = extractPrice(item.cardText);
      if (!price) continue;

      const asLowMatch = item.cardText.match(/as low as\s+\$(\d+(?:\.\d{2})?)/i);
      const finalPrice = asLowMatch ? `$${asLowMatch[1]}` : price;

      const packMatch = item.cardText.match(
        /(Box of \d+|Pack of \d+|Single|Bundle of \d+|Tins? of \d+|Sampler)/i
      );

      seen.add(item.href);
      products.push({
        store: "Cigars International",
        name,
        price: finalPrice,
        url: item.href,
        pack: packMatch ? packMatch[1] : "N/A",
        inStock: !/out of stock|sold out/i.test(item.cardText),
        lastChecked: new Date().toLocaleString(),
        sourceType: "live",
      });
    }

    console.log(`[CI] final products: ${products.length}`);
    return products;
  } catch (err) {
    console.error("[CI] scraper failed:", err.message);
    return [];
  } finally {
    if (closeBrowser) await closeBrowser();
  }
}

module.exports = searchCI;
