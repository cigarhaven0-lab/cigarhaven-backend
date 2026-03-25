async function searchThompson(query) {
  return [
    {
      store: "Thompson Cigars",
      name: `${query} (sample result)`,
      price: "$10.99",
      url: "https://www.thompsoncigar.com/"
    }
  ];
}

module.exports = searchThompson;
