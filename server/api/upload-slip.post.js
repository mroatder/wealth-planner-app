import { serverSupabaseUser, serverSupabaseClient } from '#supabase/server';

const MAX_BYTES = 4 * 1024 * 1024; // Vercel serverless body limit is ~4.5MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

// Upload into the private "slips" bucket as the signed-in user. Storage RLS (migration 005) only lets
// a user write inside their own folder, so no service-role key is needed.
async function uploadToSupabaseStorage(event, buffer, path, mimeType) {
  try {
    const client = await serverSupabaseClient(event);
    const { data, error } = await client.storage.from('slips').upload(path, buffer, { contentType: mimeType, upsert: false });
    if (error) throw error;
    return { path: data.path };
  } catch (err) {
    console.error('Supabase storage upload failed:', err.message);
    const missing = /row-level security|bucket not found|not found/i.test(err.message);
    return { error: missing ? 'ยังไม่ได้รัน migration 005_slips_storage.sql ใน Supabase' : err.message };
  }
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event);
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });

  const parts = await readMultipartFormData(event);
  const file = parts?.find((p) => p.name === 'file' && p.filename);
  if (!file) throw createError({ statusCode: 400, statusMessage: 'file is required' });
  if (!ALLOWED.includes(file.type)) throw createError({ statusCode: 415, statusMessage: 'Only JPG/PNG/WEBP allowed' });
  if (file.data.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'File larger than 4MB' });

  const uid = user.id ?? user.sub; // @nuxtjs/supabase JWT claims
  const path = `${uid}/${Date.now()}.${file.type.split('/')[1] || 'jpg'}`; // first folder = user id (RLS)

  // 1) Extract OCR text from slip image
  const ocrPromise = extractText(file.data)
    .then((r) => ({ text: r.text, engine: r.engine, note: r.note }))
    .catch((e) => ({ text: '', error: e.message }));

  // 2) Keep the original image. If this fails the OCR result is still returned, just without a stored slip
  //    (we no longer fall back to base64 in the database: it would fill the free 500MB quickly).
  const stored = await uploadToSupabaseStorage(event, file.data, path, file.type);

  const ocr = await ocrPromise;

  return {
    // driveFileId = "slips/<path>" (legacy column name); the image is opened later through a signed link
    slip: stored.path ? { driveFileId: `slips/${stored.path}`, url: null } : null,
    driveError: stored.error ?? null,
    extracted: parseSlip(ocr.text),
    rawText: ocr.text,
    ocrError: ocr.error ?? null,
    engine: ocr.engine ?? null,
    ocrNote: ocr.note ?? null,
  };
});


