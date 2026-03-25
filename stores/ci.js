const { chromium } = require("playwright");

async function searchCI(query) {
  let browser;
  let page;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    page = await browser.newPage();

    const searchUrl = `https://www.cigarsinternational.com/search?query=${encodeURIComponent(query)}`;

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(4000);

    const results = await page.evaluate(() => {
      const items = [];
      const elements = Array.from(document.querySelectorAll("a[href], li, div"));

      for (const el of elements) {
        if (items.length >= 5) break;

        const text = (el.innerText || "").trim();
        if (!text) continue;
        if (!text.includes("$")) continue;

        const priceMatch = text.match(/\$\d+(\.\d{2})?/);
        if (!priceMatch) continue;

        const linkEl = el.tagName === "A" ? el : el.querySelector("a[href]");
        if (!linkEl || !linkEl.href) continue;

        const lines = text
          .split("\n")
          .map(x => x.trim())
          .filter(Boolean);

        const name = lines.find(line => !line.includes("$"));
        if (!name || name.length < 4) continue;

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
      }

      return items;
    });

    return Array.isArray(results) ? results : [];
  } catch (error) {
    console.error("CI scraper failed:", error.message);
    return [];
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (_) {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
  }
}

module.exports = searchCI;
