const express = require("express");
const cors = require("cors");
const searchJR = require("./stores/jr");

const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.send("Cigar Haven Backend Running");
});

app.get("/search", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.json({ error: "No search query provided" });
  }

  try {
    const jrResults = await searchJR(query);

    res.json(jrResults);
  } catch (error) {
    console.error("Search route failed:", error.message);
    res.status(500).json({ error: "Search failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
