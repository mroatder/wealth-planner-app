const pad = (n) => String(n).padStart(2, '0');

export const formatMoney = (n) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

// Date -> value for <input type="datetime-local"> in the browser's local time
export const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Downscale phone-camera photos so they pass Vercel's ~4.5MB body limit and OCR faster
// A phone screenshot of a slip is ~1080x2400; shrinking it too much blurs the small Thai text OCR needs,
// so keep up to 2400px and only lower quality / size when the upload would exceed the server limit.
export async function compressImage(file, maxSide = 2400, quality = 0.9, maxBytes = 3.6 * 1024 * 1024) {
  const bitmap = await createImageBitmap(file);
  let side = maxSide;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob.size <= maxBytes || attempt === 4) return new File([blob], 'slip.jpg', { type: 'image/jpeg' });
    side = Math.round(side * 0.8);
    quality = Math.max(0.7, quality - 0.05);
  }
}
