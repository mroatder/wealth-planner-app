// Turns the OCR text of a Thai bank-transfer slip into { amount, occurredAt, bank, recipient, memo }.
// Written to cope with different apps (SCB Easy, K PLUS, Krungthai NEXT, Bualuang mBanking, ttb touch,
// MyMo, KMA, TrueMoney, Paotang ...) and with typical OCR noise: spaces between Thai letters,
// dropped dots in month names, Thai digits, "1.250.00", "1,25O.00", amount on the line after its label.

const MONTHS = [
  ['มกราคม', 'มค', 'jan', 'january'], ['กุมภาพันธ์', 'กพ', 'feb', 'february'], ['มีนาคม', 'มีค', 'mar', 'march'],
  ['เมษายน', 'เมย', 'apr', 'april'], ['พฤษภาคม', 'พค', 'may'], ['มิถุนายน', 'มิย', 'jun', 'june'],
  ['กรกฎาคม', 'กค', 'jul', 'july'], ['สิงหาคม', 'สค', 'aug', 'august'], ['กันยายน', 'กย', 'sep', 'sept', 'september'],
  ['ตุลาคม', 'ตค', 'oct', 'october'], ['พฤศจิกายน', 'พย', 'nov', 'november'], ['ธันวาคม', 'ธค', 'dec', 'december'],
];
const MONTH_LOOKUP = new Map();
MONTHS.forEach((names, i) => names.forEach((n) => MONTH_LOOKUP.set(n, i + 1)));
const monthOf = (token) => MONTH_LOOKUP.get(token.replace(/[.\s]/g, '').toLowerCase()) ?? null;

const THAI = '\\u0E00-\\u0E7F';
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

// ---------------------------------------------------------------- normalising
function normalize(raw) {
  return String(raw ?? '')
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/\r/g, '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ํา/g, 'ำ') // OCR often splits the vowel "ำ" into "ํ" + "า"; put it back together
    .replace(new RegExp(`([${THAI}])[ \\t]+(?=[${THAI}])`, 'g'), '$1') // glue letters split by OCR
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- money
// "1,250.00" "1.250.00" "1 250.00" "1,25O.00" "500" -> number
function toMoney(token) {
  const t = token.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/\s+/g, '');
  const m = /^(.*?)[.,](\d{1,2})$/.exec(t);
  const integer = (m ? m[1] : t).replace(/[.,]/g, '');
  if (!/^\d+$/.test(integer)) return null;
  const value = Number(m ? `${integer}.${m[2]}` : integer);
  return Number.isFinite(value) && value > 0 && value < 100000000 ? value : null;
}

const FEE_LINE = /ค่าธรรมเนียม|ค่าบริการ|ค่าฟี|\bfee\b|charge|คงเหลือ|balance/i; // lines that never hold the transfer amount
const AMOUNT_LABEL = /(?:จ[ำา]นวนเงินโอน|จ[ำา]นวนเงินที่โอน|จ[ำา]นวนเงิน|ยอดเงินโอน|ยอดโอนเงิน|ยอดโอน|ยอดเงิน|ยอดช[ำา]ระ|ยอดรวม|จ[ำา]นวน|transfer\s*amount|amount|total)/i;
// a money-looking token; letters O/o/I/l/| are allowed because OCR confuses them with digits
const MONEY = '\\d[\\d,. OoIl|]{0,14}[\\dOoIl|]|\\d';

const DATE_TEXT = new RegExp(`(\\d{1,2})\\s*([${THAI}][${THAI}.\\s]{0,12}?|[A-Za-z]{3,9})\\.?\\s*(\\d{2,4})(?!\\d)`, 'g');
const DATE_DMY = /(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})(?!\d)/g;
const DATE_YMD = /(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})(?!\d)/g;
const TIME = /(?<!\d)([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?:\s*[:.]\s*[0-5]\d)?(?!\d)/;

function parseAmount(lines) {
  const labelled = [];
  const unit = [];
  const plain = [];

  lines.forEach((line, i) => {
    if (FEE_LINE.test(line)) return;

    // 1) value after a label, on the same line or on the next one
    const label = AMOUNT_LABEL.exec(line);
    if (label) {
      const rest = line.slice(label.index + label[0].length);
      let m = new RegExp(`^[^\\d]{0,20}?(${MONEY})`).exec(rest);
      if (!m && lines[i + 1] && !FEE_LINE.test(lines[i + 1])) m = new RegExp(`^[^\\d]{0,12}?(${MONEY})`).exec(lines[i + 1]);
      const v = m && toMoney(m[1]);
      if (v) labelled.push(v);
    }

    // 2) number next to a currency word / symbol
    for (const m of line.matchAll(new RegExp(`(${MONEY})\\s*(?:บาท|thb|baht)|฿\\s*(${MONEY})`, 'gi'))) {
      const v = toMoney(m[1] ?? m[2]);
      if (v) unit.push(v);
    }

    // 3) any 2-decimal number, once dates and times are removed (so "14.32 น." is not an amount)
    const cleaned = line.replace(DATE_TEXT, ' ').replace(DATE_DMY, ' ').replace(DATE_YMD, ' ').replace(new RegExp(TIME.source, 'g'), ' ');
    for (const m of cleaned.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})*\.\d{2})(?![\d])/g)) {
      const v = toMoney(m[1]);
      if (v && v < 1000000) plain.push(v);
    }
  });

  const pick = labelled.length ? { v: labelled[0], from: 'label' }
    : unit.length ? { v: Math.max(...unit), from: 'unit' }
    : plain.length ? { v: Math.max(...plain), from: 'plain' }
    : null;

  const candidates = [...new Set([...labelled, ...unit.sort((a, b) => b - a), ...plain.sort((a, b) => b - a)])].slice(0, 5);
  return { amount: pick?.v ?? null, from: pick?.from ?? null, candidates };
}

// ---------------------------------------------------------------- date / time
function validDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function normalizeYear(y, twoDigitIsBuddhist) {
  let year = Number(y);
  if (String(y).length <= 2) year += twoDigitIsBuddhist ? 2500 : 2000;
  else if (String(y).length === 3) return null;
  if (year > 2400) year -= 543; // Buddhist era -> Gregorian
  return year;
}

function* dateCandidates(text) {
  const scan = function* (re, build) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      re.lastIndex = m.index + 1; // overlapping scan: a false hit must not swallow the real date
      const c = build(m);
      if (c) yield { ...c, end: m.index + m[0].length };
    }
  };
  yield* scan(DATE_TEXT, (m) => {
    const month = monthOf(m[2]);
    if (!month) return null;
    const english = /^[A-Za-z]/.test(m[2]);
    const y = normalizeYear(m[3], !english);
    return y && { y, m: month, d: Number(m[1]) };
  });
  yield* scan(DATE_DMY, (m) => {
    const y = normalizeYear(m[3], true);
    return y && { y, m: Number(m[2]), d: Number(m[1]) };
  });
  yield* scan(DATE_YMD, (m) => ({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }));
}

function parseDate(text, now) {
  const earliest = now.getTime() - 10 * 365 * 86400e3;
  const latest = now.getTime() + 2 * 86400e3;
  const found = [...dateCandidates(text)]
    .filter((c) => validDate(c.y, c.m, c.d))
    .filter((c) => { const t = Date.UTC(c.y, c.m - 1, c.d); return t >= earliest && t <= latest; })
    .sort((a, b) => a.end - b.end);
  const c = found[0];
  if (!c) return null;

  // time: right after the date, otherwise right before it
  const after = TIME.exec(text.slice(c.end, c.end + 30));
  const before = TIME.exec(text.slice(Math.max(0, c.end - 45), c.end));
  const t = after ?? before;
  const pad = (n) => String(n).padStart(2, '0');
  const hh = t ? Number(t[1]) : 12;
  const mm = t ? Number(t[2]) : 0;
  return `${c.y}-${pad(c.m)}-${pad(c.d)}T${pad(hh)}:${pad(mm)}:00+07:00`; // slips use Thailand time
}

// ---------------------------------------------------------------- bank / people
const BANKS = [
  ['truemoney', /true\s*money|ทรูมันนี่/i],
  ['paotang', /เป๋าตัง|paotang/i],
  ['linepay', /line\s*pay|ไลน์\s*เพย์|rabbit\s*line/i],
  ['shopeepay', /shopee\s*pay/i],
  ['scb', /ไทยพาณิชย์|\bscb\b|siam\s*commercial/i],
  ['kbank', /กสิกร|k\s*plus|kplus|\bkbank\b|kasikorn/i],
  ['ktb', /กรุงไทย|\bktb\b|krung\s*thai/i],
  ['bbl', /ธนาคารกรุงเทพ|กรุงเทพ(?!มหานคร)|bangkok\s*bank|\bbbl\b|bualuang/i],
  ['ttb', /ทหารไทยธนชาต|ทหารไทย|ธนชาต|\bttb\b|\btmb\b|thanachart/i],
  ['gsb', /ออมสิน|\bgsb\b|\bmymo\b|government\s*savings/i],
  ['krungsri', /กรุงศรี|krungsri|\bkma\b/i],
  ['uob', /ยูโอบี|\buob\b/i],
  ['cimb', /ซีไอเอ็มบี|\bcimb\b/i],
  ['lhbank', /แลนด์\s*แอนด์\s*เฮ้า|\blh\s*bank\b/i],
  ['kkp', /เกียรตินาคิน|\bkkp\b|ทิสโก้|\btisco\b/i],
  ['baac', /ธ\.?ก\.?ส|\bbaac\b|เพื่อการเกษตร/i],
  ['ghb', /อาคารสงเคราะห์|\bghb\b/i],
];

// A slip names the sender's bank first (header / "from"), then the receiver's: the earliest mention wins.
function parseBank(text) {
  let best = null;
  for (const [code, re] of BANKS) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) best = { code, index: m.index };
  }
  return best?.code ?? null;
}

const BANK_WORDS = new RegExp(BANKS.map(([, re]) => re.source).join('|') + '|ธนาคาร|bank', 'gi');

function spaceAfterTitle(name) {
  return name.replace(new RegExp(`^(นางสาว|นาง|นาย|น\\.ส\\.|ด\\.ช\\.|ด\\.ญ\\.|Mr\\.?|Mrs\\.?|Ms\\.?|Miss)(?=[${THAI}A-Za-z])`, 'i'), '$1 ');
}

function valueAfterLabel(lines, labelRe, clean) {
  for (let i = 0; i < lines.length; i++) {
    const m = labelRe.exec(lines[i]);
    if (!m) continue;
    let rest = lines[i].slice(m[0].length).replace(/^[\s:：]+/, '');
    if (!rest && lines[i + 1]) rest = lines[i + 1];
    const value = clean(rest);
    if (value) return value;
  }
  return null;
}

function parseRecipient(lines) {
  return valueAfterLabel(
    lines,
    /^(?:ไปยัง|ผู้รับเงิน|ผู้รับ|ชื่อบัญชีผู้รับ|ชื่อผู้รับ|โอนไปที่|ถึง|to(?=[\s:：]|$))/i,
    (raw) => {
      const name = raw.replace(BANK_WORDS, ' ').replace(/[xX*\d\-]{5,}/g, ' ').replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      return name.length >= 2 && name.length <= 40 && new RegExp(`[${THAI}A-Za-z]{2}`).test(name) ? spaceAfterTitle(name) : null;
    },
  );
}

function parseMemo(lines) {
  return valueAfterLabel(
    lines,
    /^(?:บันทึกช่วยจำ|บันทึก|หมายเหตุ|memo|note)/i,
    (raw) => {
      const memo = raw.replace(/\s+/g, ' ').trim();
      return memo.length >= 1 && memo.length <= 60 && new RegExp(`[${THAI}A-Za-z]`).test(memo) && !/^(?:บันทึกช่วยจำ|รหัส|อ้างอิง)/.test(memo) ? memo : null;
    },
  );
}

// ---------------------------------------------------------------- entry point
export function parseSlip(rawText, now = new Date()) {
  const text = normalize(rawText);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const flat = lines.join(' \n ');

  const { amount, from, candidates } = parseAmount(lines);
  const occurredAt = parseDate(flat, now);
  const bank = parseBank(text);
  const recipient = parseRecipient(lines);
  const memo = parseMemo(lines);

  const confidence = amount && occurredAt ? (from === 'label' ? 'high' : 'medium') : amount || occurredAt ? 'partial' : 'none';
  return { amount, occurredAt, bank, recipient, memo, candidates, amountSource: from, confidence };
}
