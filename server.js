const express = require("express");
const cors = require("cors");

const searchJR = require("./stores/jr");
const searchCI = require("./stores/ci");
const searchThompson = require("./stores/thompson");

const app = express();
app.use(cors());

const stores = [searchJR, searchCI, searchThompson];

app.get("/", (req, res) => {
  res.send("Cigar Haven Backend Running");
});

app.get("/search", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.json({ error: "No search query provided" });
  }

  try {
    const settled = await Promise.allSettled(
      stores.map(storeSearch => storeSearch(query))
    );

    const results = settled
      .filter(result => result.status === "fulfilled" && Array.isArray(result.value))
      .flatMap(result => result.value)
      .sort((a, b) => {
        const priceA = parseFloat(String(a.price || "").replace("$", "")) || 999999;
        const priceB = parseFloat(String(b.price || "").replace("$", "")) || 999999;
        return priceA - priceB;
      });

    res.json(results);
  } catch (error) {
    console.error("Search route failed:", error.message);
    res.status(500).json({ error: "Search failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
