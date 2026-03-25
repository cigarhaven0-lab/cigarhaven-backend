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

    await page.waitForTimeout(4000);

    const results = await page.evaluate(() => {
      const found = [];
      const links = Array.from(document.querySelectorAll("a[href]"));

      for (const link of links) {
        const text = (link.innerText || "").trim();
        const href = link.href || "";

        if (!text || !href) continue;

        const priceMatch = text.match(/\$\d+(\.\d{2})?/);
        if (!priceMatch) continue;

        const lines = text
          .split("\n")
          .map(x => x.trim())
          .filter(Boolean);

        const name = lines.find(line => !line.includes("$")) || text;

        if (!name || name.length < 4) continue;

        found.push({
          store: "Cigars International",
          name,
          price: priceMatch[0],
          url: href,
          pack: "N/A",
          inStock: true,
          lastChecked: new Date().toLocaleString(),
          sourceType: "live"
        });

        if (found.length >= 5) break;
      }

      return found;
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
