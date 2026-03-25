async function searchThompson(query) {
  return [
    {
      store: "Thompson Cigars",
      name: `${query} (sample result)`,
      price: "$10.99",
      url: "https://www.thompsoncigar.com/",
      pack: "Box of 20",
      inStock: false,
      lastChecked: new Date().toLocaleString(),
      sourceType: "sample"
    }
  ];
}

module.exports = searchThompson;
