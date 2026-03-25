const axios = require("axios");
const cheerio = require("cheerio");

function normalize(str) {
  return String(str || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getThompsonUrl(query) {
  const q = query.toLowerCase();

  if (q.includes("padron")) {
    return "https://www.thompsoncigar.com/category/all-cigar-brands/padron/";
  }

  if (q.includes("montecristo")) {
    return "https://www.thompsoncigar.com/category/all-cigar-brands/montecristo/";
  }

  if (q.includes("arturo") || q.includes("fuente")) {
    return "https://www.thompsoncigar.com/category/all-cigar-brands/arturo-fuente/";
  }

  return null;
}

function getQueryTerms(query) {
  const q = query.toLowerCase();

  if (q.includes("arturo") || q.includes("fuente")) {
    return ["arturo", "fuente"];
  }

  return q.split(/\s+/).filter(Boolean);
}

function isBadThompsonName(name) {
  const t = name.toLowerCase();

  return (
    !t ||
    t.length < 4 ||
    t === "shop now" ||
    t === "add to cart" ||
    t === "subscribe & save" ||
    t === "write a review"
  );
}

async function searchThompson(query) {
  const url = getThompsonUrl(query);
  if (!url) return [];

  const terms = getQueryTerms(query);

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      },
      timeout: 30000
    });

    const $ = cheerio.load(response.data);

    const lines = $.text()
      .split("\n")
      .map(normalize)
      .filter(Boolean);

    const results = [];
    const seen = new Set();

    $("a[href]").each((_, el) => {
      if (results.length >= 8) return false;

      let href = $(el).attr("href") || "";
      const name = normalize($(el).text());

      if (!href || isBadThompsonName(name)) return;

      if (href.startsWith("/")) {
        href = "https://www.thompsoncigar.com" + href;
      }

      if (!(href.includes("/product/") || href.includes("/p/"))) return;
      if (seen.has(href)) return;

      const lowerName = name.toLowerCase();
      const matchesQuery = terms.some(term => lowerName.includes(term));
      if (!matchesQuery) return;

      const lineIndex = lines.findIndex(line => {
        const lowerLine = line.toLowerCase();
        return lowerLine === lowerName || lowerLine.includes(lowerName);
      });

      let nearbyText = "";

      if (lineIndex !== -1) {
        nearbyText = lines.slice(lineIndex, lineIndex + 12).join(" ");
      } else {
        nearbyText = normalize($(el).closest("li, article, div").text());
      }

      const priceMatch = nearbyText.match(/\$(\d+(?:\.\d{2})?)/);
      if (!priceMatch) return;

      const packMatch = nearbyText.match(
        /(Box of \d+|Pack of \d+|Single|Bundle of \d+|Sampler|8-Cigar Sampler|5-Cigar Sampler)/i
      );

      seen.add(href);

      results.push({
        store: "Thompson Cigars",
        name,
        price: `$${priceMatch[1]}`,
        url: href,
        pack: packMatch ? packMatch[1] : "N/A",
        inStock: /in stock/i.test(nearbyText) ? true : !/out of stock/i.test(nearbyText),
        lastChecked: new Date().toLocaleString(),
        sourceType: "live"
      });
    });

    return results;
  } catch (error) {
    console.error("Thompson scraper failed:", error.message);
    return [];
  }
}

module.exports = searchThompson;
