import { tmpdir } from 'node:os';
import { google } from 'googleapis';

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
]);

async function withTesseract(buffer) {
  const { createWorker } = await import('tesseract.js');
  // Serverless file systems are read-only except the temp folder: keep the downloaded language data there,
  // so warm invocations reuse it (and nothing is written into the project folder while developing).
  const options = { cachePath: tmpdir() };
  // Optional: read the language files from a local folder (tha.traineddata, eng.traineddata) instead of the CDN.
  if (process.env.TESSERACT_LANG_PATH) Object.assign(options, { langPath: process.env.TESSERACT_LANG_PATH, gzip: false });
  const worker = await createWorker('tha+eng', 1, options);
  try {
    const { data } = await worker.recognize(buffer);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

async function withVision(buffer) {
  const vision = google.vision({ version: 'v1', auth: getGoogleAuth() });
  const { data } = await vision.images.annotate({
    requestBody: {
      requests: [{
        image: { content: buffer.toString('base64') },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['th', 'en'] },
      }],
    },
  });
  const first = data.responses?.[0];
  if (first?.error) throw new Error(first.error.message);
  return first?.fullTextAnnotation?.text ?? '';
}

// OCR_PROVIDER:
//   auto (default) - Google Cloud Vision first (far better on Thai), Tesseract if Vision is unavailable
//   vision         - Vision only
//   tesseract      - Tesseract only (free, runs on the server, weaker on photos of phone screens)
// Returns { text, engine, note } where `note` says why a fallback happened.
export async function extractText(buffer) {
  const provider = (process.env.OCR_PROVIDER || 'auto').toLowerCase();

  if (provider === 'tesseract') return { text: await withTesseract(buffer), engine: 'tesseract' };
  if (provider === 'vision') return { text: await withTimeout(withVision(buffer), 20000, 'Google Vision'), engine: 'vision' };

  let note = '';
  try {
    const text = await withTimeout(withVision(buffer), 20000, 'Google Vision');
    if (text.trim()) return { text, engine: 'vision' };
    note = 'Google Vision returned no text';
  } catch (e) {
    note = `Google Vision unavailable: ${e.message}`;
  }
  return { text: await withTesseract(buffer), engine: 'tesseract', note };
}
