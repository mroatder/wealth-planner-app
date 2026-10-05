// Minimal delimited-text parser (tab or comma, quoted fields) + sheet date parser.

export function parseDelimited(text) {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const pad = (n) => String(n).padStart(2, '0');

// Accepts "2026-03-06", "3/3/2026" and "1/3/2026, 12:00:00" (day/month/year). Returns ISO string (Thailand time) or null.
export function parseSheetDate(value) {
  const s = String(value ?? '').trim();
  let y, m, d, hh = 12, mm = 0;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (match) {
    [, y, m, d] = match; if (match[4]) { hh = Number(match[4]); mm = Number(match[5]); }
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/.exec(s))) {
    [, d, m, y] = match; if (match[4]) { hh = Number(match[4]); mm = Number(match[5]); }
  } else return null;
  y = Number(y); m = Number(m); d = Number(d);
  if (y > 2400) y -= 543;
  const check = new Date(y, m - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+07:00`;
}

export const parseBool = (v) => /^(true|1|yes|y|ใช่)$/i.test(String(v ?? '').trim());
