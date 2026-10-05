// Shared chart helpers.

// Round an axis ceiling to a clean number: 3-5 intervals with a 1/2/2.5/5 x 10^k step, tightest fit wins.
export function niceAxis(max) {
  const top = Math.max(1, max);
  let best = null;
  for (const n of [3, 4, 5]) {
    const raw = top / n;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((v) => v >= raw);
    if (!best || step * n < best.max) best = { n, step, max: step * n };
  }
  return best;
}

export const tickLabel = (v) =>
  (v >= 1e6 ? `${+(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : String(v));

// Column with a 4px rounded top and a square base, as an SVG path
export function columnPath(x, top, base, w) {
  const h = base - top;
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}
