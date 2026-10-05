// Run with:  npm run test:analytics
import assert from 'node:assert/strict';
import {
  shiftMonthKey, daysInMonthKey, monthKeyOf, monthTotals, savingsProfile, emergencyFundPlan,
  suggestBudgets, findRecurring, categoryTrends, cumulativeByDay, monthlySplit,
} from '../utils/analytics.js';

const CUR = '2026-10'; // the month being viewed
let seq = 0;
const row = (month, day, type, amount, extra = {}) => ({
  id: ++seq, type, amount, owed_amount: 0, is_fixed: false, is_shared: false, paid_by_partner: false, note: null, category_id: null,
  occurred_at: `${month}-${String(day).padStart(2, '0')}T12:00:00+07:00`, ...extra,
});
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`ok    ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// three previous months of history
const history = [
  row('2026-07', 1, 'income', 40000), row('2026-07', 5, 'expense', 30000, { category_id: 'food' }),
  row('2026-08', 1, 'income', 40000), row('2026-08', 5, 'expense', 28000, { category_id: 'food' }),
  row('2026-09', 1, 'income', 42000), row('2026-09', 5, 'expense', 32000, { category_id: 'food' }),
];

test('month keys: shifting across years and Thailand time', () => {
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
  assert.equal(daysInMonthKey('2026-02'), 28);
  assert.equal(daysInMonthKey('2028-02'), 29);
  // 00:30 on 1 Oct in Thailand is still 30 Sep in UTC
  assert.equal(monthKeyOf('2026-10-01T00:30:00+07:00'), '2026-10');
});

test('savingsProfile: averages the previous 3 months', () => {
  const p = savingsProfile(history, CUR);
  assert.equal(p.months, 3);
  near(p.avgIncome, 40666.67); near(p.avgExpense, 30000); near(p.avgSavings, 10666.67); near(p.savingsRate, 0.2623, 0.001);
});

test('savingsProfile: no history -> null; a partly empty window uses only months with data', () => {
  assert.equal(savingsProfile([], CUR), null);
  const p = savingsProfile([row('2026-09', 1, 'income', 1000), row('2026-09', 2, 'expense', 400)], CUR);
  assert.equal(p.months, 1); near(p.avgSavings, 600);
});

test('expenses count only MY share when split with the partner', () => {
  const t = monthTotals([row('2026-09', 3, 'expense', 1000, { owed_amount: 400, is_shared: true })]);
  near(t.get('2026-09').expense, 600);
});

test('emergencyFundPlan: target and months to reach it', () => {
  const plan = emergencyFundPlan(savingsProfile(history, CUR), 6);
  assert.equal(plan.target, 180000);
  assert.equal(plan.monthsToReach, 17);
  assert.equal(emergencyFundPlan({ avgExpense: 1000, avgSavings: -5 }, 3).monthsToReach, null);
  assert.equal(emergencyFundPlan(null, 3), null);
});

test('suggestBudgets: average + 10% margin rounded up; missing months count as zero; exclusions and order', () => {
  const rows = [
    row('2026-07', 3, 'expense', 4000, { category_id: 'food' }), row('2026-08', 3, 'expense', 5000, { category_id: 'food' }), row('2026-09', 3, 'expense', 6000, { category_id: 'food' }),
    row('2026-09', 9, 'expense', 900, { category_id: 'fun' }), // only one of the three months
    row('2026-09', 9, 'expense', 800, { category_id: 'gas' }),
    row('2026-10', 1, 'expense', 99999, { category_id: 'food' }), // the viewed month must not leak in
  ];
  const s = suggestBudgets(rows, CUR);
  assert.deepEqual(s.map((x) => x.categoryId), ['food', 'fun', 'gas']);
  assert.equal(s[0].suggested, 5500);
  near(s[1].avg, 300); assert.equal(s[1].suggested, 400);
  assert.equal(suggestBudgets(rows, CUR, { exclude: new Set(['food']) }).length, 2);
  assert.equal(suggestBudgets(rows, CUR, { max: 1 }).length, 1);
  assert.deepEqual(suggestBudgets([], CUR), []);
  // floating point: 12,000 + 10% must be 13,200, not 13,300
  const steady = ['2026-07', '2026-08', '2026-09'].map((m) => row(m, 3, 'expense', 12000, { category_id: 'rent' }));
  assert.equal(suggestBudgets(steady, CUR)[0].suggested, 13200);
});

test('findRecurring: needs 3 different months; ignores one-offs and same-month repeats; handles partner suffix and digits', () => {
  const rows = [];
  for (const m of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) rows.push(row(m, 10, 'expense', 419, { note: 'Netflix', category_id: 'sub', is_fixed: true }));
  ['2026-06', '2026-07', '2026-08', '2026-09'].forEach((m, i) => rows.push(row(m, 4, 'expense', [1000, 1200, 1400, 1100][i], { note: `ค่าไฟ ${i + 6}`, category_id: 'util' })));
  ['2026-07', '2026-08', '2026-09'].forEach((m) => rows.push(row(m, 2, 'expense', 450, { owed_amount: 225, is_shared: true, note: 'ค่าเน็ต' })));
  rows.push(row('2026-09', 2, 'expense', 900, { paid_by_partner: true, is_shared: true, note: 'ค่าเน็ต · Rin จ่าย ยอดรวม 900.00' }));
  rows.push(row('2026-09', 6, 'expense', 50, { note: 'ทาโกยากิ' }));
  // an everyday habit: lunch ~10 times in each of 4 months must NOT count as a recurring cost
  for (const m of ['2026-06', '2026-07', '2026-08', '2026-09']) for (let d = 10; d < 20; d++) rows.push(row(m, d, 'expense', 80, { note: 'ข้าวกลางวัน' }));
  for (let d = 1; d <= 4; d++) rows.push(row('2026-09', d, 'expense', 60, { note: 'ค่ากาแฟ' })); // same month only
  rows.push(row('2026-08', 1, 'expense', 300, { note: 'จากสลิป' }), row('2026-09', 1, 'expense', 300, { note: 'จากสลิป' }), row('2026-07', 1, 'expense', 300, { note: 'จากสลิป' }));
  const r = findRecurring(rows);
  // sorted by monthly cost: electricity ~1,175 > internet ~525 (225 + 225 + 1,125) > Netflix 419
  assert.deepEqual(r.map((x) => x.label), ['ค่าไฟ 6', 'ค่าเน็ต', 'Netflix']);
  const byName = Object.fromEntries(r.map((x) => [x.label.replace(/ \d+$/, ''), x]));
  assert.ok(byName['Netflix'] && byName['Netflix'].steady && byName['Netflix'].fixed && byName['Netflix'].months === 5);
  near(byName['Netflix'].monthlyAvg, 419);
  assert.ok(byName['ค่าไฟ'] && byName['ค่าไฟ'].months === 4);
  assert.ok(byName['ค่าเน็ต'] && byName['ค่าเน็ต'].months === 3, 'partner-paid row joins the same group');
  assert.ok(!byName['ทาโกยากิ'] && !byName['ค่ากาแฟ'] && !byName['จากสลิป'] && !byName['ข้าวกลางวัน']);
});

test('categoryTrends: top categories over 6 months with the latest compared to the earlier average', () => {
  const rows = [];
  ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].forEach((m) => rows.push(row(m, 3, 'expense', 1000, { category_id: 'food' })));
  rows.push(row('2026-10', 3, 'expense', 1500, { category_id: 'food' }));
  rows.push(row('2026-10', 4, 'expense', 200, { category_id: 'gas' }));
  rows.push(row('2026-03', 4, 'expense', 777, { category_id: 'old' })); // outside the window
  const t = categoryTrends(rows, CUR, { months: 6, top: 5 });
  assert.deepEqual(t.keys, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(t.rows.map((r) => r.categoryId), ['food', 'gas']);
  assert.deepEqual(t.rows[0].values, [1000, 1000, 1000, 1000, 1000, 1500]);
  near(t.rows[0].vsAvg, 0.5);
  assert.equal(t.rows[1].vsAvg, null);
});

test('cumulativeByDay: running total, null for days that have not happened, Thailand midnight counted in the right day', () => {
  const rows = [row('2026-10', 1, 'expense', 100), row('2026-10', 3, 'expense', 50), { ...row('2026-10', 1, 'expense', 10), occurred_at: '2026-10-01T00:30:00+07:00' }, row('2026-09', 3, 'expense', 999)];
  const c = cumulativeByDay(rows, CUR, 5);
  assert.equal(c.length, 31);
  assert.deepEqual(c.slice(0, 6), [110, 110, 160, 160, 160, null]);
  assert.equal(cumulativeByDay(rows, CUR)[30], 160);
});

test('monthlySplit: personal vs shared (my share), oldest month first', () => {
  const rows = [
    row('2026-10', 1, 'expense', 500), row('2026-10', 2, 'expense', 1000, { owed_amount: 500, is_shared: true }),
    row('2026-10', 3, 'expense', 300, { paid_by_partner: true, is_shared: true }), row('2026-09', 3, 'expense', 200),
    row('2026-10', 4, 'income', 9999),
  ];
  const s = monthlySplit(rows, CUR, 3);
  assert.deepEqual(s.map((m) => m.key), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual([s[2].personal, s[2].shared], [500, 800]);
  assert.deepEqual([s[1].personal, s[1].shared], [200, 0]);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
