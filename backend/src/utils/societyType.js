// Maps the County's "type of society" wording to the broad value chain the system
// uses for scoring and reports. The exact wording is kept separately (societyType).
const VALUE_CHAINS = ["COFFEE", "DAIRY", "MIRAA", "IRRIGATION", "TEA", "SUGARCANE", "COTTON", "CASHEWNUT", "FISHERIES", "LIVESTOCK", "POULTRY", "SACCO", "HOUSING", "TRANSPORT", "HANDICRAFTS", "OTHER"];

function valueChainFor(label) {
  const t = String(label || "").trim().toUpperCase();
  if (!t) return "OTHER";
  if (VALUE_CHAINS.includes(t)) return t;
  if (t.includes("SACCO")) return "SACCO"; // SACCO, NYS SACCO, DT. SACCO
  if (t.includes("COFFEE")) return "COFFEE";
  if (t.includes("DAIRY") || t.includes("MILK")) return "DAIRY";
  if (t.includes("MUGUKA") || t.includes("MIRAA") || t.includes("KHAT")) return "MIRAA";
  if (t.includes("IRRIGATION")) return "IRRIGATION";
  if (t.includes("HOUSING")) return "HOUSING";
  if (t.includes("TRANSPORT") || t.includes("BODA") || t.includes("MATATU")) return "TRANSPORT";
  if (t.includes("TEA")) return "TEA";
  if (t.includes("SUGAR")) return "SUGARCANE";
  if (t.includes("COTTON")) return "COTTON";
  if (t.includes("CASHEW")) return "CASHEWNUT";
  if (t.includes("FISH")) return "FISHERIES";
  if (t.includes("POULTRY") || t.includes("EGG")) return "POULTRY";
  if (t.includes("LIVESTOCK") || t.includes("BEEF") || t.includes("GOAT")) return "LIVESTOCK";
  if (t.includes("HANDICRAFT")) return "HANDICRAFTS";
  return "OTHER"; // CEREALS, MANGO, BANANAS, FRUITS, MULTIPURPOSE, BAMBOO, MARKETING, UNION, MINING ...
}
module.exports = { valueChainFor, VALUE_CHAINS };
