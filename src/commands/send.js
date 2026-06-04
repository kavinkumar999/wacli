// `wa send <to> <message...> [--file <path>]`
//
//   wa send 919876543210 "hello there"
//   wa send 919876543210 "see attached" --file ./photo.png
//   wa send 12036..@g.us "message to a group"
//
// <to> is an international number (digits, with country code) or a group jid
// (…@g.us). With --file the message text becomes the media caption; the media
// type (image/video/audio/document) is inferred from the file extension.

import { promises as fs } from 'fs';
import path from 'path';
import { authDir, hasSession } from '../lib/auth.js';
import { isGroupJid, toJid } from '../lib/jid.js';
import { sleep } from '../lib/util.js';
import { connectWithRetry } from '../lib/whatsapp.js';

const MIME = {
  // images
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
  // video
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.webm': 'video/webm', '.3gp': 'video/3gpp',
  // audio
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg', '.wav': 'audio/wav', '.aac': 'audio/aac',
  // common documents
  '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain', '.csv': 'text/csv',
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.3gp']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.ogg', '.opus', '.wav', '.aac']);

/** Build a Baileys message content object for a media file. */
function mediaContent(filePath, caption) {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const mimetype = MIME[ext];

  if (IMAGE_EXT.has(ext)) return { image: { url: filePath }, caption: caption || undefined };
  if (VIDEO_EXT.has(ext)) return { video: { url: filePath }, caption: caption || undefined };
  if (AUDIO_EXT.has(ext)) return { audio: { url: filePath }, mimetype: mimetype || 'audio/mp4' };
  // Everything else goes as a document so the recipient gets the original file.
  return {
    document: { url: filePath },
    fileName,
    mimetype: mimetype || 'application/octet-stream',
    caption: caption || undefined,
  };
}

/** Split args into the leading flag values and positional words. */
function parse(args) {
  const positionals = [];
  let file;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' || args[i] === '-f') {
      file = args[++i];
    } else {
      positionals.push(args[i]);
    }
  }
  const [to, ...rest] = positionals;
  return { to, text: rest.join(' '), file };
}

export async function run(args) {
  const { to, text, file } = parse(args);

  if (!to) throw new Error('Usage: wa send <number|jid> <message...> [--file <path>]');
  if (!text && !file) throw new Error('Nothing to send: provide a message, a --file, or both.');
  if (!(await hasSession())) throw new Error('Not linked. Run `wa link` first.');

  const jid = toJid(to);

  if (file) {
    // Fail early with a clear message rather than deep inside Baileys.
    await fs.access(file).catch(() => {
      throw new Error(`File not found: ${file}`);
    });
  }

  const sock = await connectWithRetry(authDir());
  try {
    // For 1:1 chats, confirm the number is actually on WhatsApp (groups skip this).
    if (!isGroupJid(jid)) {
      const [hit] = await sock.onWhatsApp(jid);
      if (!hit?.exists) {
        throw new Error(`${to} is not on WhatsApp (or the number/country code is wrong).`);
      }
    }

    const content = file ? mediaContent(file, text) : { text };
    await sock.sendMessage(jid, content);
    console.log(`sent → ${jid}${file ? `  (${path.basename(file)})` : ''}`);
  } finally {
    await sleep(1_000); // let the send + creds flush before we tear down
    sock.end(undefined);
  }
  process.exit(0);
}
