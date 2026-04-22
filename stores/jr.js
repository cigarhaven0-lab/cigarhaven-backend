/**
 * jr.js — JR Cigars scraper with detailed logging
 */

const { openPage, normalize, extractPrice, queryTerms, matchesQuery } = require("./scraper");

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
  let closeBrowser;

  console.log(`[JR] scraping: ${url}`);

  try {
    const result = await openPage(url, { timeout: 50000 });
    const page = result.page;
    closeBrowser = result.closeBrowser;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(2000);

    // Count all links to understand what the page loaded
    const diagnostics = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll("a[href]"));
      const itemLinks = allLinks.filter(a => a.href.includes("/item/"));
      const priceEls = document.querySelectorAll("[class*='price'], [class*='Price']");
      return {
        totalLinks: allLinks.length,
        itemLinks: itemLinks.length,
        priceElements: priceEls.length,
        sampleItemLinks: itemLinks.slice(0, 3).map(a => ({ href: a.href, text: a.innerText.trim().slice(0, 50) })),
      };
    });

    console.log(`[JR] diagnostics:`, JSON.stringify(diagnostics));

    const items = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      const anchors = Array.from(document.querySelectorAll("a[href*='/item/']"));

      for (const anchor of anchors) {
        const href = anchor.href || "";
        if (!href || !href.includes("/item/")) continue;
        if (seen.has(href)) continue;
        seen.add(href);

        const name = (anchor.innerText || anchor.textContent || "").trim();

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

    console.log(`[JR] raw items found: ${items.length}`);

    const seen = new Set();
    const products = [];

    for (const item of items) {
      if (products.length >= 10) break;
      if (seen.has(item.href)) continue;

      const name = normalize(item.name)
        .replace(/^wishlist toggle/i, "")
        .replace(/quick view/gi, "")
        .trim();

      if (!name || name.length < 4) continue;
      if (!matchesQuery(name + " " + item.cardText, terms)) continue;

      const price = extractPrice(item.cardText);
      if (!price) continue;

      const packMatch = item.cardText.match(
        /(Box of \d+|Pack of \d+|Single|Bundle of \d+|Tin of \d+|Cedar Chest of \d+)/i
      );

      seen.add(item.href);
      products.push({
        store: "JR Cigars",
        name,
        price,
        url: item.href,
        pack: packMatch ? packMatch[1] : "N/A",
        inStock: !/sold out|out of stock|backorder/i.test(item.cardText),
        lastChecked: new Date().toLocaleString(),
        sourceType: "live",
      });
    }

    console.log(`[JR] final products: ${products.length}`);
    return products;
  } catch (err) {
    console.error("[JR] scraper failed:", err.message);
    return [];
  } finally {
    if (closeBrowser) await closeBrowser();
  }
}

module.exports = searchJR;
