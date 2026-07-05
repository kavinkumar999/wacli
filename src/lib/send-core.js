// Shared, side-effect-free sending core used by both `wa send` (scriptable) and
// `wa ui` (interactive TUI). Keeps a single, well-tested send path: MIME
// detection, media-content shaping, canonical-jid resolution, and the actual
// sock.sendMessage call. Nothing here connects, prints, or exits — callers own
// the socket lifecycle.

import { promises as fs } from 'fs';
import path from 'path';
import { isGroupJid, isLidJid, looksNumeric, toJid } from './jid.js';
import { loadContacts, searchContacts } from './contacts-store.js';

export const MIME = {
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
export function mediaContent(filePath, caption) {
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

/**
 * Resolve the canonical JID to send to. For 1:1 chats we ask the server via
 * onWhatsApp and send to whatever jid it returns (which may be a @lid, not
 * "<digits>@s.whatsapp.net"). Groups are passed through untouched. Only hard-fails
 * when the server explicitly says the number is not on WhatsApp.
 *
 * @param {any} sock
 * @param {string} jid  a jid from toJid()
 * @param {string} [label]  the original user input, for error messages
 * @returns {Promise<string>} the jid to send to
 */
export async function resolveTarget(sock, jid, label = jid) {
  if (isGroupJid(jid)) return jid;
  if (isLidJid(jid)) return jid;
  const number = jid.split('@')[0];
  const results = await sock.onWhatsApp(number).catch(() => []);
  const hit = results?.[0];
  if (hit?.exists === false) {
    throw new Error(`${label} is not on WhatsApp (check the number and its country code).`);
  }
  return hit?.jid || jid;
}

/**
 * Turn raw user input into a recipient — OFFLINE, before any socket is opened, so
 * a bad or ambiguous name fails fast. A jid (contains `@`) or a number-looking
 * string passes straight through; anything else is treated as a contact NAME and
 * looked up in the local cache (built by `wa contacts sync` / passive capture).
 *
 * @param {string} to  raw user input (number, jid, or contact name)
 * @param {{ maxlist?: number }} [opts]
 * @returns {Promise<{ to: string, name: string, number?: string, matched: boolean }>}
 *   `to` is what to hand to sendTo(); `matched` is true when it came from a name.
 * @throws when a name matches zero or multiple contacts.
 */
export async function resolveRecipient(to, { maxlist = 8 } = {}) {
  const raw = String(to ?? '').trim();
  if (!raw) {
    throw new Error('Missing recipient. Pass a name, a number (e.g. 919876543210), or a group jid (…@g.us).');
  }
  if (raw.includes('@')) return { to: raw, name: raw, matched: false };
  if (looksNumeric(raw)) {
    return { to: raw, name: `+${raw.replace(/[^0-9]/g, '')}`, matched: false };
  }

  // A name — search the local contact cache.
  const map = await loadContacts();
  const hits = searchContacts(map, raw);

  if (hits.length === 0) {
    throw new Error(
      `No saved contact matches "${raw}". Run \`wa contacts sync\` to refresh your ` +
        `contacts, or pass the number (e.g. 919876543210) / group jid directly.`
    );
  }

  // Accept a single hit, or a single exact-name (rank 0) winner among several.
  const exact = hits.filter((h) => h.rank === 0);
  const winner = hits.length === 1 ? hits[0] : exact.length === 1 ? exact[0] : null;

  if (!winner) {
    const list = hits
      .slice(0, maxlist)
      .map((h) => `    • ${h.name || h.notify}  —  +${h.number}`)
      .join('\n');
    const more = hits.length > maxlist ? `\n    …and ${hits.length - maxlist} more` : '';
    throw new Error(
      `"${raw}" matches ${hits.length} contacts:\n${list}${more}\n` +
        `Use a more specific name, or pass the number/jid directly.`
    );
  }

  return {
    to: winner.jid,
    name: winner.name || winner.notify,
    number: winner.number,
    matched: true,
  };
}

/**
 * Send text and/or a file to a recipient. Resolves the recipient, verifies the
 * file exists, and sends. Returns the jid actually sent to.
 *
 * @param {any} sock  an open Baileys socket
 * @param {string} to  number or jid (raw user input)
 * @param {{ text?: string, file?: string }} content
 * @returns {Promise<string>} the canonical jid sent to
 */
export async function sendTo(sock, to, { text, file } = {}) {
  if (!text && !file) throw new Error('Nothing to send: provide a message, a file, or both.');
  const jid = toJid(to);

  if (file) {
    await fs.access(file).catch(() => {
      throw new Error(`File not found: ${file}`);
    });
  }

  const target = await resolveTarget(sock, jid, to);
  const message = file ? mediaContent(file, text) : { text };
  await sock.sendMessage(target, message);
  return target;
}
