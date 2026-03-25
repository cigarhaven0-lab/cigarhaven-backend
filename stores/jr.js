async function searchJR(query) {
  return [
    {
      store: "JR Cigars",
      name: `${query} (sample result)`,
      price: "$12.99",
      url: "https://www.jrcigars.com/",
      pack: "Single",
      inStock: true,
      lastChecked: new Date().toLocaleString(),
      sourceType: "sample"
    }
  ];
}

module.exports = searchJR;
