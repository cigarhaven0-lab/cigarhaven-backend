const axios = require("axios");
const cheerio = require("cheerio");

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
  try {
    const url = getCIUrl(query);

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      },
      timeout: 30000
    });

    const $ = cheerio.load(response.data);
    const results = [];
    const seen = new Set();

    $('a[href*="/p/"]').each((_, el) => {
      if (results.length >= 8) return false;

      let href = $(el).attr("href");
      const name = $(el).text().trim();

      if (!href || !name || name.length < 4) return;

      if (href.startsWith("/")) {
        href = "https://www.cigarsinternational.com" + href;
      }

      if (seen.has(href)) return;
      seen.add(href);

      const container =
        $(el).closest("li, article, div");

      const text = container.text().replace(/\s+/g, " ").trim();
      const priceMatch = text.match(/(?:As low as )?\$(\d+(?:\.\d{2})?)/i);

      if (!priceMatch) return;

      const price = `$${priceMatch[1]}`;

      results.push({
        store: "Cigars International",
        name,
        price,
        url: href,
        pack: "N/A",
        inStock: !/out of stock/i.test(text),
        lastChecked: new Date().toLocaleString(),
        sourceType: "live"
      });
    });

    return results;
  } catch (error) {
    console.error("CI scraper failed:", error.message);
    return [];
  }
}

module.exports = searchCI;
