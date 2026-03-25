const axios = require("axios");
const cheerio = require("cheerio");

function normalize(str) {
  return String(str || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getJRUrl(query) {
  const q = query.toLowerCase();

  if (q.includes("padron")) {
    return "https://www.jrcigars.com/cigars/handmade-cigars/padron-cigars/";
  }

  if (q.includes("montecristo")) {
    return "https://www.jrcigars.com/cigars/handmade-cigars/montecristo-cigars/";
  }

  if (q.includes("arturo") || q.includes("fuente")) {
    return "https://www.jrcigars.com/cigars/handmade-cigars/arturo-fuente-cigars/";
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

function cleanJRName(text) {
  return normalize(text)
    .replace(/^wishlist toggle/i, "")
    .replace(/\$\d+(?:\.\d{2})?/, "")
    .replace(/save \$.*$/i, "")
    .replace(/\bquick view\b/gi, "")
    .trim();
}

function isBadJRName(name) {
  const t = name.toLowerCase();

  return (
    !t ||
    t.length < 4 ||
    t === "quick view" ||
    t === "wishlist toggle" ||
    t === "add to cart"
  );
}

async function searchJR(query) {
  const url = getJRUrl(query);
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
    const results = [];
    const seen = new Set();

    $('a[href*="/item/"]').each((_, el) => {
      if (results.length >= 8) return false;

      let href = $(el).attr("href") || "";
      const anchorText = normalize($(el).text());
      const containerText = normalize($(el).closest("li, article, div").text());
      const combinedText = normalize(`${anchorText} ${containerText}`);

      if (!href) return;
      if (href.startsWith("/")) {
        href = "https://www.jrcigars.com" + href;
      }

      if (seen.has(href)) return;

      const priceMatch = combinedText.match(/\$(\d+(?:\.\d{2})?)/);
      if (!priceMatch) return;

      const name = cleanJRName(anchorText || combinedText);
      if (isBadJRName(name)) return;

      const lowerName = name.toLowerCase();
      const matchesQuery = terms.some(term => lowerName.includes(term));
      if (!matchesQuery) return;

      const packMatch = combinedText.match(
        /(Box of \d+|Pack of \d+|Single|Bundle of \d+|Cedar Chest of \d+|5 Tins of \d+|Tin of \d+)/i
      );

      seen.add(href);

      results.push({
        store: "JR Cigars",
        name,
        price: `$${priceMatch[1]}`,
        url: href,
        pack: packMatch ? packMatch[1] : "N/A",
        inStock: !/sold out|backorder|out of stock/i.test(combinedText),
        lastChecked: new Date().toLocaleString(),
        sourceType: "live"
      });
    });

    return results;
  } catch (error) {
    console.error("JR scraper failed:", error.message);
    return [];
  }
}

module.exports = searchJR;
