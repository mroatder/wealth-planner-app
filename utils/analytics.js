// Pure helpers behind the analytics page (no Vue, no network), so they can be unit-tested: npm run test:analytics
//
// A "row" is a transaction: { type, amount, owed_amount, is_fixed, is_shared, paid_by_partner, note, occurred_at, category_id }.
// Spending always means MY share: amount minus what the partner pays back (a partner-paid row already stores only my share).

const THAILAND_OFFSET = 7 * 3600e3;
export const bkkDate = (iso) => new Date(new Date(iso).getTime() + THAILAND_OFFSET); // wall clock in Thailand, read with getUTC*
export const monthKeyOf = (iso) => bkkDate(iso).toISOString().slice(0, 7); // "2026-10"
export const shiftMonthKey = (key, delta) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
export const daysInMonthKey = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

const share = (r) => Number(r.amount) - Number(r.owed_amount || 0);
const isExpense = (r) => r.type === 'expense';
const isSharedRow = (r) => !!r.is_shared || Number(r.owed_amount) > 0 || !!r.paid_by_partner;

// ---------------------------------------------------------------- totals per month
export function monthTotals(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = monthKeyOf(r.occurred_at);
    const t = map.get(key) ?? { income: 0, expense: 0 };
    if (r.type === 'income') t.income += Number(r.amount);
    else if (isExpense(r)) t.expense += share(r);
    map.set(key, t);
  }
  return map;
}

// ---------------------------------------------------------------- saving capacity
// Average of the `months` months BEFORE monthKey that have any data. null when there is no history yet.
export function savingsProfile(rows, monthKey, months = 3) {
  const totals = monthTotals(rows);
  const used = [];
  for (let i = 1; i <= months; i++) {
    const t = totals.get(shiftMonthKey(monthKey, -i));
    if (t && (t.income > 0 || t.expense > 0)) used.push(t);
  }
  if (!used.length) return null;
  const avg = (pick) => used.reduce((s, t) => s + pick(t), 0) / used.length;
  const avgIncome = avg((t) => t.income);
  const avgExpense = avg((t) => t.expense);
  const avgSavings = avgIncome - avgExpense;
  return { months: used.length, avgIncome, avgExpense, avgSavings, savingsRate: avgIncome > 0 ? avgSavings / avgIncome : null };
}

// Emergency fund covering `cover` months of spending, and how long it takes at the current saving pace.
export function emergencyFundPlan(profile, cover) {
  if (!profile) return null;
  const target = Math.ceil((profile.avgExpense * cover) / 100) * 100;
  return { cover, target, monthsToReach: profile.avgSavings > 0 ? Math.ceil(target / profile.avgSavings) : null };
}

// ---------------------------------------------------------------- budget suggestions
// Per expense category: average monthly spend over the previous `months` months (months without spend count as 0),
// plus a safety margin, rounded up to a clean number.
export function suggestBudgets(rows, monthKey, { months = 3, buffer = 0.1, step = 100, exclude = new Set(), max = 10 } = {}) {
  const keys = Array.from({ length: months }, (_, i) => shiftMonthKey(monthKey, -(i + 1)));
  const totals = monthTotals(rows);
  const monthsWithData = keys.filter((k) => (totals.get(k)?.expense ?? 0) > 0).length;
  if (!monthsWithData) return [];

  const perCategory = new Map(); // categoryId -> { total, months:Set }
  for (const r of rows) {
    if (!isExpense(r) || !r.category_id) continue;
    const key = monthKeyOf(r.occurred_at);
    if (!keys.includes(key)) continue;
    const c = perCategory.get(r.category_id) ?? { total: 0, months: new Set() };
    c.total += share(r);
    c.months.add(key);
    perCategory.set(r.category_id, c);
  }
  return [...perCategory.entries()]
    .filter(([id]) => !exclude.has(id))
    .map(([categoryId, c]) => {
      const avg = c.total / monthsWithData;
      // toFixed first: 12000 * 1.1 is 13200.000000000002 in floating point and would otherwise round UP to 13300
      const padded = Number((avg * (1 + buffer)).toFixed(6));
      return { categoryId, avg, suggested: Math.max(step, Math.ceil(padded / step) * step), monthsPresent: c.months.size };
    })
    .filter((s) => s.avg > 0)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, max);
}

// ---------------------------------------------------------------- recurring payments
// Same description in at least `minMonths` different months AND roughly once a month (<= maxPerMonth) -> a recurring cost
// (subscription, utility, instalment ...). Everyday habits such as lunch or coffee repeat far more often, so they are left out.
const GENERIC_NOTES = new Set(['จากสลิป']);
function noteKey(note) {
  return String(note ?? '')
    .split(' · ')[0] // drop the "… · Rin จ่าย ยอดรวม …" suffix added for partner-paid rows
    .toLowerCase()
    .replace(/[\d.,/:()\-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findRecurring(rows, { minMonths = 3, maxPerMonth = 1.5, max = 8 } = {}) {
  const groups = new Map();
  for (const r of rows) {
    if (!isExpense(r) || !r.note) continue;
    const key = noteKey(r.note);
    if (key.length < 2 || GENERIC_NOTES.has(r.note.trim())) continue;
    const g = groups.get(key) ?? { label: r.note.split(' · ')[0].trim(), months: new Map(), count: 0, fixed: 0, categoryId: r.category_id };
    const month = monthKeyOf(r.occurred_at);
    g.months.set(month, (g.months.get(month) ?? 0) + share(r));
    g.count++;
    if (r.is_fixed) g.fixed++;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.months.size >= minMonths && g.count / g.months.size <= maxPerMonth)
    .map((g) => {
      const monthly = [...g.months.values()];
      const mean = monthly.reduce((s, v) => s + v, 0) / monthly.length;
      const sd = Math.sqrt(monthly.reduce((s, v) => s + (v - mean) ** 2, 0) / monthly.length);
      return {
        label: g.label, categoryId: g.categoryId, months: g.months.size, occurrences: g.count,
        monthlyAvg: mean, steady: mean > 0 && sd / mean < 0.25, fixed: g.fixed >= g.count / 2,
      };
    })
    .sort((a, b) => b.monthlyAvg - a.monthlyAvg)
    .slice(0, max);
}

// ---------------------------------------------------------------- category trends
// Monthly spend of the biggest categories over the last `months` months (ending at monthKey).
export function categoryTrends(rows, monthKey, { months = 6, top = 6 } = {}) {
  const keys = Array.from({ length: months }, (_, i) => shiftMonthKey(monthKey, i - (months - 1)));
  const per = new Map(); // categoryId -> number[]
  for (const r of rows) {
    if (!isExpense(r)) continue;
    const i = keys.indexOf(monthKeyOf(r.occurred_at));
    if (i < 0) continue;
    const id = r.category_id ?? 'none';
    const values = per.get(id) ?? Array(months).fill(0);
    values[i] += share(r);
    per.set(id, values);
  }
  return {
    keys,
    rows: [...per.entries()]
      .map(([categoryId, values]) => {
        const earlier = values.slice(0, -1);
        const earlierAvg = earlier.reduce((s, v) => s + v, 0) / Math.max(earlier.length, 1);
        const last = values.at(-1);
        return { categoryId, values, total: values.reduce((s, v) => s + v, 0), last, earlierAvg, vsAvg: earlierAvg > 0 ? (last - earlierAvg) / earlierAvg : null };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, top),
  };
}

// ---------------------------------------------------------------- spending pace
// Running total of spending by day of the month. Days after `upToDay` are null (they have not happened yet).
export function cumulativeByDay(rows, monthKey, upToDay = Infinity) {
  const days = daysInMonthKey(monthKey);
  const perDay = Array(days + 1).fill(0);
  for (const r of rows) {
    if (!isExpense(r) || monthKeyOf(r.occurred_at) !== monthKey) continue;
    perDay[bkkDate(r.occurred_at).getUTCDate()] += share(r);
  }
  const out = [];
  let run = 0;
  for (let d = 1; d <= days; d++) {
    run += perDay[d];
    out.push(d <= upToDay ? Math.round(run * 100) / 100 : null);
  }
  return out;
}

// ---------------------------------------------------------------- personal vs shared, per month
export function monthlySplit(rows, monthKey, months = 6) {
  const keys = Array.from({ length: months }, (_, i) => shiftMonthKey(monthKey, i - (months - 1)));
  const out = new Map(keys.map((k) => [k, { key: k, personal: 0, shared: 0 }]));
  for (const r of rows) {
    if (!isExpense(r)) continue;
    const m = out.get(monthKeyOf(r.occurred_at));
    if (!m) continue;
    m[isSharedRow(r) ? 'shared' : 'personal'] += share(r);
  }
  return [...out.values()];
}
