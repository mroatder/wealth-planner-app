import { google } from 'googleapis';

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const creds = JSON.parse(text);
  creds.private_key = creds.private_key.replace(/\\n/g, '\n');
  return creds;
}

let cached;
export function getGoogleAuth() {
  cached ??= new google.auth.GoogleAuth({
    credentials: loadCredentials(),
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/cloud-platform'],
  });
  return cached;
}
