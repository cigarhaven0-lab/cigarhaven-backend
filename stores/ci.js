async function searchCI(query) {
  return [
    {
      store: "Cigars International",
      name: `${query} (sample result)`,
      price: "$11.49",
      url: "https://www.cigarsinternational.com/"
    }
  ];
}

module.exports = searchCI;
