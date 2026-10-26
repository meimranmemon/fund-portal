// PSX brokerage + government tax + CGT calculations.
// Defaults match the slab the user specified; all are editable per investor via psx_settings.

export function brokerageCommission(pricePerShare, quantity, settings) {
  const tradeValue = pricePerShare * quantity;
  if (pricePerShare <= settings.slab1_max) {
    return (settings.slab1_paisa / 100) * quantity;    // "0.03 paisa" per share => Rs. 0.0003/share
  }
  return tradeValue * (settings.slab2_pct / 100);
}

export function govtTax(pricePerShare, quantity, settings) {
  return pricePerShare * quantity * (settings.govt_tax_pct / 100);
}

// Total cost to add when BUYING (on top of price*qty)
export function buySideCosts(pricePerShare, quantity, settings) {
  const brokerage = brokerageCommission(pricePerShare, quantity, settings);
  const tax = govtTax(pricePerShare, quantity, settings);
  return { brokerage, tax, total: brokerage + tax };
}

// Total cost to deduct when SELLING (brokerage + tax on sale value; CGT computed separately on gain)
export function sellSideCosts(pricePerShare, quantity, settings) {
  const brokerage = brokerageCommission(pricePerShare, quantity, settings);
  const tax = govtTax(pricePerShare, quantity, settings);
  return { brokerage, tax, total: brokerage + tax };
}

// Full realized P/L for a lot being sold now.
export function computeSale(lot, sellPrice, settings) {
  const qty = Number(lot.quantity);
  const buyCosts = Number(lot.buy_commission) || 0;
  const sell = sellSideCosts(sellPrice, qty, settings);
  const grossGain = (sellPrice - Number(lot.buy_price)) * qty;
  const gainAfterCosts = grossGain - buyCosts - sell.total;
  const cgt = gainAfterCosts > 0 ? gainAfterCosts * (settings.cgt_pct / 100) : 0;
  const netPl = gainAfterCosts - cgt;
  return { sellCommission: sell.total, cgtAmount: cgt, grossGain, netPl };
}

export function defaultSettings() {
  return { govt_tax_pct: 0.15, cgt_pct: 15, slab1_max: 20, slab1_paisa: 0.03, slab2_pct: 0.15 };
}