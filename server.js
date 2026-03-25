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
    const resultsArrays = await Promise.all(
      stores.map(storeSearch => storeSearch(query))
    );

    const results = resultsArrays.flat();
    res.json(results);
  } catch (error) {
    console.error("Search failed:", error.message);
    res.status(500).json({ error: "Search failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
