const axios = require("axios");
const cheerio = require("cheerio");

async function searchJR(query) {
  try {
    const searchUrl = `https://www.jrcigars.com/search?q=${encodeURIComponent(query)}`;

    const response = await axios.get(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $(".product, .product-tile, .product-grid-item, .search-result-item").each((index, element) => {
      if (index >= 5) return;

      const name =
        $(element).find(".product-name, .name, .product-title, a").first().text().trim();

      const price =
        $(element).find(".price, .sales, .product-price").first().text().trim();

      let url =
        $(element).find("a").first().attr("href");

      if (url && url.startsWith("/")) {
        url = "https://www.jrcigars.com" + url;
      }

      if (name && price) {
        results.push({
          store: "JR Cigars",
          name,
          price,
          url: url || searchUrl
        });
      }
    });

    return results;
  } catch (error) {
    console.error("JR search failed:", error.message);
    return [];
  }
}

module.exports = searchJR;
