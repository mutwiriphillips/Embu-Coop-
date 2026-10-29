// Turns produce deliveries into "how much, at what average price" lines, so a
// payout can be explained as quantity x price. Works for every value chain:
// lines are grouped by produce type AND unit (kg of coffee is never added to
// litres of milk), and the average price is weighted by quantity, over the
// deliveries that actually have a price. Deliveries with no price yet are
// counted and reported, never guessed.

const r2 = (n) => Math.round(n * 100) / 100;

function valueOf(d) {
  if (d.totalValue !== null && d.totalValue !== undefined) return Number(d.totalValue);
  if (d.ratePerUnit !== null && d.ratePerUnit !== undefined) return Number(d.quantity) * Number(d.ratePerUnit);
  return null;
}

/** @param deliveries rows with produceType, unit, quantity, ratePerUnit, totalValue */
function summariseProduce(deliveries) {
  const lines = new Map();
  for (const d of deliveries) {
    const type = String(d.produceType || "").trim() || "Produce";
    const key = `${type.toLowerCase()}|${d.unit}`;
    if (!lines.has(key)) lines.set(key, { produceType: type, unit: d.unit, quantity: 0, pricedQuantity: 0, value: 0, deliveries: 0, unpricedDeliveries: 0 });
    const l = lines.get(key);
    const q = Number(d.quantity);
    const v = valueOf(d);
    l.quantity += q;
    l.deliveries += 1;
    if (v === null) l.unpricedDeliveries += 1;
    else { l.pricedQuantity += q; l.value += v; }
  }
  return [...lines.values()]
    .map((l) => ({
      produceType: l.produceType, unit: l.unit, deliveries: l.deliveries, unpricedDeliveries: l.unpricedDeliveries,
      quantity: r2(l.quantity), pricedQuantity: r2(l.pricedQuantity), value: r2(l.value),
      avgPrice: l.pricedQuantity > 0 ? r2(l.value / l.pricedQuantity) : null,
    }))
    .sort((a, b) => b.value - a.value || a.produceType.localeCompare(b.produceType));
}

module.exports = { summariseProduce, valueOf };
