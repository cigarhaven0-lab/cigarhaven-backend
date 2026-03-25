const { chromium } = require("playwright");

function getCIUrl(query) {
  const q = query.toLowerCase();

  if (q.includes("padron")) {
    return "https://www.cigarsinternational.com/shop/padron-cigars/1701404/";
  }

  if (q.includes("montecristo")) {
    return "https://www.cigarsinternational.com/shop/montecristo-cigars/1701371/";
  }

  if (q.includes("arturo") || q.includes("fuente")) {
    return "https://www.cigarsinternational.com/shop/arturo-fuente-cigars/1701026/";
  }

  return `https://www.cigarsinternational.com/search/?q=${encodeURIComponent(query)}`;
}

async function searchCI(query) {
  let browser;
  let page;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    page = await browser.newPage();

    const url = getCIUrl(query);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3000);

    const results = await page.evaluate(() => {
      const out = [];
      const seen = new Set();

      const links = Array.from(
        document.querySelectorAll('a[href*="/p/"], a[href*="/shop/"]')
      );

      for (const link of links) {
        if (out.length >= 8) break;

        const href = link.href;
        if (!href || seen.has(href)) continue;
        seen.add(href);

        const container =
          link.closest("li") ||
          link.closest("article") ||
          link.closest("div");

        if (!container) continue;

        const text = (container.innerText || "").trim();
        if (!text) continue;

        const priceMatch = text.match(/\$\d+(\.\d{2})?/);
        if (!priceMatch) continue;

        const name =
          (link.innerText || "").trim() ||
          text.split("\n").map(x => x.trim()).filter(Boolean)[0];

        if (!name || name.length < 4) continue;

        out.push({
          store: "Cigars International",
          name,
          price: priceMatch[0],
          url: href,
          pack: "N/A",
          inStock: !/out of stock/i.test(text),
          lastChecked: new Date().toLocaleString(),
          sourceType: "live"
        });
      }

      return out;
    });

    return Array.isArray(results) ? results : [];
  } catch (error) {
    console.error("CI scraper failed:", error.message);
    return [];
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

module.exports = searchCI;
