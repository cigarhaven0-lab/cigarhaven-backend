async function searchCI(query) {
  return [
    {
      store: "Cigars International",
      name: `${query} (sample result)`,
      price: "$11.49",
      url: "https://www.cigarsinternational.com/",
      pack: "5-Pack",
      inStock: true,
      lastChecked: new Date().toLocaleString(),
      sourceType: "sample"
    }
  ];
}

module.exports = searchCI;
