/* Amounts are nominal U.S. dollars, input in millions.
   Billions always show two decimals: $17.10B, $41.04 billion.
   Under $1 billion stays in millions, with one decimal only when needed:
   $250M, $13.8 million. Amounts below $1 billion remain in millions. Near the boundary,
   preserve a second decimal to avoid rounding across the unit boundary. Legend ticks round to whole millions. */
window.formatInvestment = function (amount, prose = false, tick = false) {
  if (amount == null) return prose ? "No state total" : "Not disclosed";
  const m = Number(amount);
  const billions = Math.abs(m) >= 1000;
  const value = billions
    ? (m / 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : tick && Math.abs(m) >= 100 ? String(Math.round(m)) : String(Number(m.toFixed(Math.abs(m) > 999.9 ? 2 : 1)));
  return "$" + value + (prose ? (billions ? " billion" : " million") : (billions ? "B" : "M"));
};
