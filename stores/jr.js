async function searchJR(query) {
  return [
    {
      store: "JR Cigars",
      name: `${query} (sample result)`,
      price: "$12.99",
      url: "https://www.jrcigars.com/"
    }
  ];
}

module.exports = searchJR;
