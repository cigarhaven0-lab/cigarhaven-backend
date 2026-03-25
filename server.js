const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.send("Cigar Haven Backend Running");
});

// TEST search route (we will improve this later)
app.get("/search", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.json({ error: "No search query provided" });
  }

  // fake results for now
  const results = [
    {
      store: "JR Cigars",
      name: query,
      price: "$12.99",
      url: "https://www.jrcigars.com/"
    },
    {
      store: "Cigars International",
      name: query,
      price: "$11.49",
      url: "https://www.cigarsinternational.com/"
    }
  ];

  res.json(results);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
