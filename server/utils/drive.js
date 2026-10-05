import { google } from 'googleapis';
import { Readable } from 'node:stream';

export async function uploadToDrive({ buffer, filename, mimeType }) {
  const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
  const { data } = await drive.files.create({
    requestBody: { name: filename, parents: [process.env.GOOGLE_DRIVE_FOLDER_ID] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
    supportsTeamDrives: true,
  });
  return { fileId: data.id, name: data.name, url: data.webViewLink };
}
