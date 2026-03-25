const products = require("../data/jr-products.json");

async function searchJR(query) {
  const search = query.toLowerCase();

  const matches = products
    .filter(product => product.name.toLowerCase().includes(search))
    .map(product => ({
      store: "JR Cigars",
      name: product.name,
      price: product.price,
      url: product.url,
      pack: product.pack,
      inStock: product.inStock,
      lastChecked: new Date().toLocaleString(),
      sourceType: "dataset"
    }));

  return matches;
}

module.exports = searchJR;
