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

function normalizeText(str) {
  return String(str || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTerms(query) {
  const q = query.toLowerCase();
  if (q.includes("arturo") || q.includes("fuente")) {
    return ["arturo", "fuente"];
  }
  return q.split(/\s+/).filter(Boolean);
}

function isUsefulAnchor(text, href, terms) {
  const t = text.toLowerCase();

  if (!href) return false;
  if (!href.includes("/p/")) return false;
  if (text.length < 4) return false;

  const bad = [
    "shop now",
    "login",
    "register",
    "my account",
    "cart",
    "help",
    "request a catalog",
    "receive email specials"
  ];

  if (bad.includes(t)) return false;

  return terms.some(term => t.includes(term));
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

    const scraped = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]")).map(a => ({
        text: (a.innerText || a.textContent || "").trim(),
        href: a.href || ""
      }));

      return {
        title: document.title || "",
        finalUrl: location.href,
        bodyText: document.body ? document.body.innerText || "" : "",
        anchors
      };
    });

    const terms = queryTerms(query);
    const lines = scraped.bodyText
      .split("\n")
      .map(normalizeText)
      .filter(Boolean);

    const anchors = scraped.anchors
      .map(a => ({
        text: normalizeText(a.text),
        href: a.href
      }))
      .filter(a => isUsefulAnchor(a.text, a.href, terms));

    const seenHref = new Set();
    const results = [];

    for (const anchor of anchors) {
      if (results.length >= 8) break;
      if (seenHref.has(anchor.href)) continue;
      seenHref.add(anchor.href);

      const idx = lines.findIndex(line => line === anchor.text || line.includes(anchor.text));

      if (idx === -1) continue;

      const windowText = lines.slice(idx, idx + 12).join(" ");
      const priceMatch = windowText.match(/(?:As low as )?\$(\d+(?:\.\d{2})?)/i);

      if (!priceMatch) continue;

      const textAround = lines.slice(idx, idx + 12).join(" ").toLowerCase();

      results.push({
        store: "Cigars International",
        name: anchor.text,
        price: `$${priceMatch[1]}`,
        url: anchor.href,
        pack: "N/A",
        inStock: !textAround.includes("out of stock"),
        lastChecked: new Date().toLocaleString(),
        sourceType: "live"
      });
    }

    return results;
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
