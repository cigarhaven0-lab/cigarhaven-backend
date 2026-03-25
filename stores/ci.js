const { chromium } = require("playwright");

async function searchCI(query) {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  try {
    const url = `https://www.cigarsinternational.com/search/?q=${encodeURIComponent(query)}`;

    await page.goto(url, { waitUntil: "domcontentloaded" });

    await page.waitForTimeout(3000); // let page fully load

    const results = await page.evaluate(() => {
      const items = [];

      const elements = document.querySelectorAll("li, div");

      elements.forEach(el => {
        if (items.length >= 5) return;

        const text = el.innerText;

        if (!text || !text.toLowerCase().includes("$")) return;

        const priceMatch = text.match(/\$\d+(\.\d{2})?/);
        if (!priceMatch) return;

        const linkEl = el.querySelector("a");
        if (!linkEl || !linkEl.href) return;

        const name = text.split("\n")[0];

        items.push({
          store: "Cigars International",
          name: name.trim(),
          price: priceMatch[0],
          url: linkEl.href.startsWith("http")
            ? linkEl.href
            : "https://www.cigarsinternational.com" + linkEl.getAttribute("href"),
          pack: "N/A",
          inStock: true,
          lastChecked: new Date().toLocaleString(),
          sourceType: "live"
        });
      });

      return items;
    });

    await browser.close();
    return results;

  } catch (error) {
    console.error("CI Scraper Error:", error.message);
    await browser.close();
    return [];
  }
}

module.exports = searchCI;
