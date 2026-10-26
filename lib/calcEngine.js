import { db } from "hatchable";
import {
  getLatestAndPrevious, getBenchmarkReturn, dailyReturnPct, allocatedAmount, gainLoss, pktToday,
} from "./engine.js";
import { refreshNews } from "./newsStore.js";
import { getPsxToken, getIndexSeries, getEod, periodStats, pktDate, prevFromEod } from "./psxApi.js";

// Fills in past trading days the user never refreshed on, using PSX's official daily closes
// and the fund's CURRENT weights / investment amount (marked source='backfill'). Never
// overwrites an existing row, and skips any day where a holding has no PSX close.
async function backfillFunds(funds, allHoldings, token, benchSeries) {
  if (!token || !funds.length) return 0;
  const { rows: ex } = await db.query(
    "SELECT fund_id, trading_date::text AS d FROM fund_daily_summary WHERE fund_id = ANY($1::uuid[]) AND NOT (source = 'live' AND ABS(COALESCE(total_return_pct,0)) < 0.01 AND trading_date < CURRENT_DATE)", [funds.map(f => f.id)]);
  const have = new Map();
  for (const r of ex) { if (!have.has(r.fund_id)) have.set(r.fund_id, new Set()); have.get(r.fund_id).add(r.d.slice(0, 10)); }

  const plans = [];
  for (const f of funds) {
    const bs = benchSeries[f.benchmark];
    if (!bs || bs.length < 3) continue;
    const created = pktDate(Math.floor(new Date(f.created_at).getTime() / 1000));
    const live = bs[bs.length - 1].date, got = have.get(f.id) || new Set();
    const missing = [];
    for (let k = 1; k < bs.length; k++) { const d = bs[k].date; if (d > created && d < live && !got.has(d)) missing.push(k); }
    if (missing.length) plans.push({ f, bs, missing });
  }
  if (!plans.length) return 0;

  const tickers = [...new Set(plans.flatMap(p => allHoldings.filter(h => h.fund_id === p.f.id && h.ticker).map(h => h.ticker)))];
  const tseries = new Map();
  for (let i = 0; i < tickers.length; i += 4) {
    await Promise.all(tickers.slice(i, i + 4).map(async t => {
      const e = await getEod(t, token);
      if (e) { const m = new Map(); e.forEach((p, idx) => m.set(p.date, { close: p.close, prev: idx > 0 ? e[idx - 1].close : null })); tseries.set(t, m); }
    }));
  }

  const R = { o: [], f: [], d: [], g: [], r: [], b: [], i: [] };
  for (const { f, bs, missing } of plans) {
    const holdings = allHoldings.filter(h => h.fund_id === f.id);
    const inv = Number(f.total_investment_amount) || 0;
    if (!holdings.length || !inv) continue;
    const remaining = Math.max(100 - holdings.reduce((s, h) => s + Number(h.weight_pct), 0), 0);
    for (const k of missing) {
      const benchRet = ((bs[k].close - bs[k - 1].close) / bs[k - 1].close) * 100;
      let total = inv * remaining / 100 * benchRet / 100, ok = true;
      for (const h of holdings) {
        const p = h.ticker && tseries.get(h.ticker) && tseries.get(h.ticker).get(bs[k].date);
        if (!p || !p.prev) { ok = false; break; }
        total += inv * Number(h.weight_pct) / 100 * ((p.close - p.prev) / p.prev);
      }
      if (!ok) continue;
      R.o.push(f.owner_user_id); R.f.push(f.id); R.d.push(bs[k].date); R.g.push(total); R.r.push(total / inv * 100); R.b.push(benchRet); R.i.push(inv);
    }
  }
  if (!R.f.length) return 0;
  await db.query(
    `INSERT INTO fund_daily_summary (owner_user_id, fund_id, trading_date, total_gain_loss_amount, total_return_pct,
       market_contribution_pct, validation_status, investment_amount, source)
     SELECT x.o, x.f, x.d, x.g, x.r, x.b, 'OK', x.i, 'backfill'
     FROM unnest($1::text[], $2::uuid[], $3::date[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[]) AS x(o, f, d, g, r, b, i)
     ON CONFLICT (fund_id, trading_date) DO NOTHING`,
    [R.o, R.f, R.d, R.g, R.r, R.b, R.i]);
  return R.f.length;
}

// DB budget: the platform allows 100 queries / 10 s for the WHOLE project.
// A full refresh here uses ~7 queries no matter how many funds/companies exist.

async function fetchQuotes(tickers) {
  const list = [...new Set(tickers.filter(Boolean))];
  const map = new Map();
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async (t) => map.set(t, await getLatestAndPrevious(t))));
  }
  return map;
}

async function runForFunds(funds) {
  if (!funds.length) return [];
  const ids = funds.map(f => f.id);
  const { rows: allHoldings } = await db.query(
    "SELECT * FROM holdings WHERE fund_id = ANY($1::uuid[])", [ids]);                       // query 1
  const quotes = await fetchQuotes(allHoldings.map(h => h.ticker));
  const benchNames = [...new Set(funds.map(f => f.benchmark))];
  const bench = {};
  // Benchmark = OFFICIAL PSX index (live level vs previous close). Falls back to the old
  // constituents-based estimate only if PSX's API can't be reached.
  const psxToken = await getPsxToken();
  {
    // PSX's company page shows LDCP = today's close after market close (day change reads 0).
    // Use the previous close from PSX's official daily history instead.
    const tk = [...new Set(allHoldings.map(h => h.ticker).filter(Boolean))];
    for (let i = 0; i < tk.length; i += 4) {
      await Promise.all(tk.slice(i, i + 4).map(async t => {
        const q = quotes.get(t);
        if (!q || q.status !== "OK" || !psxToken) return;
        const e = await getEod(t, psxToken), p = e && prevFromEod(e, q.date);
        if (p) q.previous = p;
      }));
    }
  }
  const benchSeries = {};
  const BSYM = { "KSE-100": "KSE100", "KMI-30": "KMI30" };
  await Promise.all(benchNames.map(async b => {
    let st = null;
    if (BSYM[b] && psxToken) {
      const s = await getIndexSeries(BSYM[b], psxToken);
      if (s) { benchSeries[b] = s; st = periodStats(s); }
    }
    bench[b] = st ? { returnPct: st.day_pct, status: "OK" } : await getBenchmarkReturn(b);
  }));

  const D = { owner: [], fund: [], holding: [], date: [], alloc: [], ret: [], gl: [], status: [], cur: [], prev: [], asof: [] };
  const S = { owner: [], fund: [], date: [], gl: [], ret: [], bench: [], valid: [], inv: [] };
  const P = new Map();          // price_history rows, de-duplicated by ticker|date
  const results = [];

  for (const fund of funds) {
    const holdings = allHoldings.filter(h => h.fund_id === fund.id);
    const explicitSum = holdings.reduce((s, h) => s + Number(h.weight_pct), 0);
    const remaining = Math.round((100 - explicitSum) * 100) / 100;
    const validation = explicitSum > 100.0001 ? "WEIGHTAGE VALIDATION ERROR" : "OK";
    const dates = holdings.map(h => quotes.get(h.ticker)?.date).filter(Boolean).sort();
    const tradingDate = dates.length ? dates[dates.length - 1] : pktToday();   // PSX's own trading date

    let total = 0, missing = false;
    for (const h of holdings) {
      const q = h.ticker ? quotes.get(h.ticker) : null;
      const allocated = allocatedAmount(fund.total_investment_amount, h.weight_pct);
      let status = "OK", ret = null, gl = null;
      if (!h.ticker) { status = "MANUAL VERIFICATION REQUIRED"; missing = true; }
      else if (!q || q.status !== "OK") { status = q ? q.status : "PSX DATA UNAVAILABLE"; missing = true; }
      else {
        ret = dailyReturnPct(q.current, q.previous);
        gl = gainLoss(allocated, ret);
        total += gl;
        P.set(h.ticker + "|" + (q.date || tradingDate), { t: h.ticker, d: q.date || tradingDate, c: q.current, p: q.previous, hi: q.dayHigh, lo: q.dayLow });
      }
      D.owner.push(fund.owner_user_id); D.fund.push(fund.id); D.holding.push(h.id); D.date.push(tradingDate);
      D.alloc.push(allocated); D.ret.push(ret); D.gl.push(gl); D.status.push(status);
      D.cur.push(q?.current ?? null); D.prev.push(q?.previous ?? null); D.asof.push(q?.asof ?? null);
    }

    const b = bench[fund.benchmark] || { returnPct: null, status: "DATA NOT AVAILABLE" };
    const marketAlloc = allocatedAmount(fund.total_investment_amount, Math.max(remaining, 0));
    let marketGL = null;
    if (remaining <= 0) marketGL = 0;
    else if (b.status === "OK") marketGL = gainLoss(marketAlloc, b.returnPct);
    if (marketGL === null) missing = true; else total += marketGL;

    const complete = !missing && holdings.length > 0;
    const inv = Number(fund.total_investment_amount) || 0;
    const totalGL = complete ? total : null;
    const totalRet = complete && inv > 0 ? (total / inv) * 100 : null;

    S.owner.push(fund.owner_user_id); S.fund.push(fund.id); S.date.push(tradingDate); S.gl.push(totalGL);
    S.ret.push(totalRet); S.bench.push(b.returnPct); S.valid.push(validation); S.inv.push(inv);
    results.push({ fund_id: fund.id, name: fund.name, owner: fund.owner_user_id, trading_date: tradingDate,
      complete, total_gain_loss: totalGL, total_return_pct: totalRet, benchmark_return_pct: b.returnPct, validation });
  }

  if (D.holding.length) {
    await db.query(                                                                          // query 2
      `INSERT INTO daily_gain_loss (owner_user_id, fund_id, holding_id, trading_date, allocated_amount,
         price_change_pct, gain_loss_amount, data_status, current_price, previous_close, quote_asof)
       SELECT * FROM unnest($1::text[], $2::uuid[], $3::uuid[], $4::date[], $5::numeric[], $6::numeric[],
                            $7::numeric[], $8::text[], $9::numeric[], $10::numeric[], $11::text[])
       ON CONFLICT (holding_id, trading_date) DO UPDATE SET
         allocated_amount = EXCLUDED.allocated_amount, price_change_pct = EXCLUDED.price_change_pct,
         gain_loss_amount = EXCLUDED.gain_loss_amount, data_status = EXCLUDED.data_status,
         current_price = EXCLUDED.current_price, previous_close = EXCLUDED.previous_close,
         quote_asof = EXCLUDED.quote_asof`,
      [D.owner, D.fund, D.holding, D.date, D.alloc, D.ret, D.gl, D.status, D.cur, D.prev, D.asof]);
  }
  if (P.size) {
    const rows = [...P.values()];
    await db.query(                                                                          // query 3
      `INSERT INTO price_history (ticker, trading_date, close_price, previous_close, day_high, day_low)
       SELECT * FROM unnest($1::text[], $2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[])
       ON CONFLICT (ticker, trading_date) DO UPDATE SET close_price = EXCLUDED.close_price,
         previous_close = EXCLUDED.previous_close, day_high = EXCLUDED.day_high, day_low = EXCLUDED.day_low,
         retrieved_at = now()`,
      [rows.map(r => r.t), rows.map(r => r.d), rows.map(r => r.c), rows.map(r => r.p),
       rows.map(r => r.hi), rows.map(r => r.lo)]);
  }
  await db.query(                                                                            // query 4
    `INSERT INTO fund_daily_summary (owner_user_id, fund_id, trading_date, total_gain_loss_amount,
       total_return_pct, market_contribution_pct, validation_status, investment_amount)
     SELECT * FROM unnest($1::text[], $2::uuid[], $3::date[], $4::numeric[], $5::numeric[], $6::numeric[], $7::text[], $8::numeric[])
     ON CONFLICT (fund_id, trading_date) DO UPDATE SET
       total_gain_loss_amount = EXCLUDED.total_gain_loss_amount, total_return_pct = EXCLUDED.total_return_pct,
       market_contribution_pct = EXCLUDED.market_contribution_pct, validation_status = EXCLUDED.validation_status,
       investment_amount = EXCLUDED.investment_amount, source = 'live'`,
    [S.owner, S.fund, S.date, S.gl, S.ret, S.bench, S.valid, S.inv]);

  // Live ticks: add a point only when a fund's P/L changed (or last point is > 10 min old)
  const { rows: lastTicks } = await db.query(                                                // query 5
    `SELECT DISTINCT ON (fund_id) fund_id, total_gain_loss, ts FROM fund_ticks
     WHERE fund_id = ANY($1::uuid[]) ORDER BY fund_id, ts DESC`, [ids]);
  const lastBy = new Map(lastTicks.map(t => [t.fund_id, t]));
  const T = { owner: [], fund: [], date: [], gl: [], ret: [], bench: [] };
  for (const r of results) {
    if (!r.complete) continue;
    const last = lastBy.get(r.fund_id);
    const stale = !last || Date.now() - new Date(last.ts).getTime() > 10 * 60 * 1000;
    if (stale || Math.abs(Number(last.total_gain_loss) - r.total_gain_loss) > 0.005) {
      T.owner.push(r.owner); T.fund.push(r.fund_id); T.date.push(r.trading_date);
      T.gl.push(r.total_gain_loss); T.ret.push(r.total_return_pct); T.bench.push(r.benchmark_return_pct);
    }
  }
  if (T.fund.length) {
    await db.query(                                                                          // query 6
      `INSERT INTO fund_ticks (owner_user_id, fund_id, trading_date, total_gain_loss, total_return_pct, benchmark_return_pct)
       SELECT * FROM unnest($1::text[], $2::uuid[], $3::date[], $4::numeric[], $5::numeric[], $6::numeric[])`,
      [T.owner, T.fund, T.date, T.gl, T.ret, T.bench]);
  }
  await backfillFunds(funds, allHoldings, psxToken, benchSeries);
  return results.map(({ owner, ...r }) => r);
}

export async function runForOwner(ownerUserId) {
  const { rows } = await db.query("SELECT * FROM funds WHERE owner_user_id = $1 ORDER BY created_at", [ownerUserId]);
  return runForFunds(rows);
}

export async function runForAllFunds() {
  const { rows } = await db.query("SELECT * FROM funds");
  return runForFunds(rows);
}

export async function runBulletin(label) {
  const funds = await runForAllFunds();
  const news = await refreshNews();
  return { label, generated_at: new Date().toISOString(), funds_processed: funds.length, news_stored: news.stored };
}