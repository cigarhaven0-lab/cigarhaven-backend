/**
 * scraper.js - Shared utilities for all store scrapers
 */

function normalize(str) {
  return String(str || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function extractPrice(text) {
  const match = text.match(/\$\s*(\d{1,4}(?:\.\d{2})?)/);
  return match ? `$${match[1]}` : null;
}

function queryTerms(query) {
  const q = query.toLowerCase().trim();
  if (q.includes("arturo") || q.includes("fuente")) return ["arturo", "fuente"];
  if (q.includes("romeo") || q.includes("julieta")) return ["romeo", "julieta"];
  return q.split(/\s+/).filter(w => w.length > 1);
}

function matchesQuery(text, terms) {
  const t = text.toLowerCase();
  return terms.some(term => t.includes(term));
}

module.exports = { normalize, extractPrice, queryTerms, matchesQuery };
