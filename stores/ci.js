const { chromium } = require("playwright");

async function searchCI(query) {
  console.log("CI LIVE SCRAPER RUNNING");

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    const searchUrl = `https://www.cigarsinternational.com/search?query=${encodeURIComponent(query)}`;

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // wait for page content to load
    await page.waitForTimeout(4000);

    const results = await page.evaluate(() => {
      const items = [];

      const products = document.querySelectorAll(
        ".product-grid-item, .search-result-item, .product"
      );

      products.forEach(product => {
        if (items.length >= 5) return;

        const nameEl =
          product.querySelector(".product-name") ||
          product.querySelector(".product-title") ||
          product.querySelector("a");

        const priceEl =
          product.querySelector(".price") ||
          product.querySelector(".product-price") ||
          product.querySelector(".sales");

        const linkEl = product.querySelector("a");

        if (!nameEl || !priceEl || !linkEl) return;

        const name = nameEl.innerText.trim();
        const priceMatch = priceEl.innerText.match(/\$\d+(\.\d{2})?/);

        if (!priceMatch) return;

        items.push({
          store: "Cigars International",
          name,
          price: priceMatch[0],
          url: linkEl.href,
          pack: "N/A",
          inStock: true,
          lastChecked: new Date().toLocaleString(),
          sourceType: "live"
        });
      });

      return items;
    });

    return results;
  } catch (error) {
    console.error("CI live search failed:", error.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = searchCI;
