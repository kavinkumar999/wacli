// Local, persistent contact cache + name matcher.
//
// Baileys has no built-in contact store, and your saved contact names only arrive
// transiently via WhatsApp's sync events (`contacts.upsert`, `contacts.set`, and the
// `contacts` array inside `messaging-history.set`). Each entry looks like:
//   { id: "<number>@s.whatsapp.net", name, notify, verifiedName }
// where `name` is your address-book name and `notify` is the pushName.
//
// We capture those events into a small JSON file next to the session so `wa send`
// and `wa ui` can turn a typed NAME into a jid — offline and instantly. This
// module is side-effect-free in spirit (like send-core.js): it never connects,
// prints, or exits. Callers own the socket and decide when to save.

import { ALL_WA_PATCH_NAMES } from '@whiskeysockets/baileys';
import { promises as fs } from 'fs';
import path from 'path';
import { authDir } from './auth.js';
import { isGroupJid, isLidJid, isPersonJid } from './jid.js';
import { sleep } from './util.js';

const FILE_VERSION = 1;

/** Fraction of cached contacts that must have a saved name before we skip replay. */
const SPARSE_NAME_RATIO = 0.15;

/** Delete local app-state version checkpoints so the next resync replays snapshots. */
async function resetAppStateVersions() {
  const dir = authDir();
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    files
      .filter((f) => f.startsWith('app-state-sync-version-') && f.endsWith('.json'))
      .map((f) => fs.unlink(path.join(dir, f))),
  );
}

/** Saved address-book names live in app state; replay them via contacts.upsert. */
export async function replayContactNames(sock) {
  if (typeof sock.resyncAppState !== 'function') return;
  await resetAppStateVersions();
  await sock.resyncAppState([...ALL_WA_PATCH_NAMES], true);
}

function namedCount(map) {
  return Object.values(map).filter((c) => c.name).length;
}

function needsNameReplay(map) {
  const total = Object.keys(map).length;
  if (total === 0) return true;
  return namedCount(map) / total < SPARSE_NAME_RATIO;
}

/** Where the contact cache lives: beside the auth folder (honors WA_AUTH_DIR). */
export function contactsFile() {
  return path.join(path.dirname(authDir()), 'contacts.json');
}

/** Digits of a jid's user part; empty for @lid (no public number). */
function numberFromJid(jid) {
  if (isLidJid(jid)) return '';
  return String(jid).split('@')[0].replace(/[^0-9]/g, '');
}

/** Prefer a sendable phone jid; fall back to @lid when WhatsApp hides the number. */
function canonicalContactJid(c) {
  const phone = c?.jid;
  if (phone && isPersonJid(phone) && !isLidJid(phone)) return phone;
  const id = c?.id;
  if (id && isPersonJid(id) && !isLidJid(id)) return id;
  if (phone && isLidJid(phone)) return phone;
  if (id && isLidJid(id)) return id;
  if (phone && isPersonJid(phone)) return phone;
  if (id && isPersonJid(id)) return id;
  return null;
}

/**
 * Load the cache as a plain object keyed by jid. Missing or corrupt file -> {} .
 * Never throws.
 * @returns {Promise<Record<string, {jid:string, number:string, name:string, notify:string}>>}
 */
export async function loadContacts() {
  try {
    const raw = await fs.readFile(contactsFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.contacts === 'object' && parsed.contacts ? parsed.contacts : {};
  } catch {
    return {};
  }
}

/**
 * Persist the cache. Creates the parent directory if needed. Never throws on a
 * write race; callers that care can await the returned promise.
 * @param {Record<string, object>} map
 */
export async function saveContacts(map) {
  const file = contactsFile();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const body = {
    version: FILE_VERSION,
    updatedAt: new Date().toISOString(),
    contacts: map,
  };
  await fs.writeFile(file, JSON.stringify(body, null, 2), { mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

/**
 * Merge an array of Baileys contact objects into `map` (mutates it). Skips group
 * jids and entries with no usable name. Prefers a real address-book `name`, and
 * never overwrites an existing name with an empty one.
 *
 * @param {Record<string, object>} map
 * @param {Array<{id?:string, jid?:string, name?:string, notify?:string, verifiedName?:string}>} incoming
 * @returns {number} how many entries were added or changed
 */
export function upsertContacts(map, incoming = []) {
  let changed = 0;
  for (const c of incoming) {
    const jid = canonicalContactJid(c);
    if (!jid || !isPersonJid(jid)) continue;

    const name = (c.name || c.verifiedName || '').trim();
    let notify = (c.notify || '').trim();
    const digits = numberFromJid(jid);
    // Group members often arrive as bare jids with no display name — still cache them.
    if (!name && !notify && digits) notify = `+${digits}`;
    if (!name && !notify) continue;

    const prev = map[jid];
    const merged = {
      jid,
      lid: isLidJid(jid) ? jid : (c.lid || prev?.lid || ''),
      number: numberFromJid(jid) || prev?.number || '',
      name: name || prev?.name || '',
      notify: notify || prev?.notify || '',
    };
    if (!prev || prev.name !== merged.name || prev.notify !== merged.notify
        || prev.number !== merged.number || prev.lid !== merged.lid) {
      map[jid] = merged;
      changed++;
    }
  }
  return changed;
}

/** Normalize for matching: lowercase, trim, collapse internal whitespace. */
function norm(s) {
  return String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Rank a single field against a normalized query. Lower is better; Infinity = no match. */
function rankField(field, q) {
  const f = norm(field);
  if (!f) return Infinity;
  if (f === q) return 0;
  if (f.startsWith(q)) return 1;
  if (f.split(' ').some((w) => w.startsWith(q))) return 2; // word-boundary
  if (f.includes(q)) return 3;
  return Infinity;
}

/**
 * Search the cache by name/notify. Returns matching entries (each with a `rank`),
 * best first, then alphabetical by name.
 *
 * @param {Record<string, object>} map
 * @param {string} query
 * @returns {Array<{jid:string, number:string, name:string, notify:string, rank:number}>}
 */
export function searchContacts(map, query) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const entry of Object.values(map)) {
    const rank = Math.min(rankField(entry.name, q), rankField(entry.notify, q));
    if (rank !== Infinity) out.push({ ...entry, rank });
  }
  out.sort((a, b) => a.rank - b.rank || norm(a.name || a.notify).localeCompare(norm(b.name || b.notify)));
  return out;
}

/**
 * Attach listeners that feed contact sync events into `map`. Used by both the
 * explicit `wa contacts sync` (collect for a window) and passive capture on every
 * connection. `onChange(total)` fires whenever new contacts land.
 *
 * @param {any} sock  a Baileys socket
 * @param {Record<string, object>} map  the cache to fill (mutated in place)
 * @param {{ onChange?: (total:number, changed:number) => void }} [opts]
 */
export function attachContactCapture(sock, map, { onChange } = {}) {
  const feed = (list) => {
    const changed = upsertContacts(map, list || []);
    if (changed && onChange) onChange(Object.keys(map).length, changed);
  };
  // `contacts.upsert` / `contacts.set` deliver arrays of contact objects.
  sock.ev.on('contacts.upsert', (list) => feed(list));
  sock.ev.on('contacts.set', (payload) => feed(payload?.contacts || payload));
  // Partial name/notify patches (common on reconnect without a full history sync).
  sock.ev.on('contacts.update', (list) => feed(list));
  // History sync delivers address-book entries and 1:1 chat display names.
  sock.ev.on('messaging-history.set', (payload) => {
    feed(payload?.contacts);
    for (const chat of payload?.chats || []) {
      if (!chat?.id || !isPersonJid(chat.id)) continue;
      const name = (chat.name || '').trim();
      if (name) feed([{ id: chat.id, name, lid: chat.lidJid }]);
    }
  });
}

/**
 * Add people from every group you're in (reliable server-side list).
 * Names come from participant metadata when WhatsApp provides them.
 */
export async function ingestGroupParticipants(sock, map) {
  try {
    const groups = await sock.groupFetchAllParticipating();
    for (const g of Object.values(groups)) {
      upsertContacts(map, g.participants || []);
    }
  } catch {
    // ignore — other sources still apply
  }
}

/**
 * Pull saved contact names from WhatsApp into `map`.
 * Passive event listening alone is not enough after the first link — WhatsApp
 * only re-streams the full book during `wa link`; later refreshes need an
 * explicit app-state resync.
 *
 * @param {any} sock
 * @param {Record<string, object>} map
 * @param {{ waitMs?: number, onChange?: (total:number, changed:number) => void, attach?: boolean, replayNames?: boolean }} [opts]
 *        `replayNames` replays the app-state address book (slow; needed when names
 *        are missing). Defaults to true when fewer than 15% of contacts have names.
 */
export async function pullContacts(sock, map, { waitMs = 3_000, onChange, attach = true, replayNames } = {}) {
  if (attach) attachContactCapture(sock, map, { onChange });
  if (typeof sock.resyncAppState === 'function') {
    if (replayNames ?? needsNameReplay(map)) {
      await replayContactNames(sock);
    } else {
      await sock.resyncAppState([...ALL_WA_PATCH_NAMES], true);
    }
  }
  // Groups are the most reliable non-address-book source of people + numbers.
  await ingestGroupParticipants(sock, map);
  if (waitMs > 0) await sleep(waitMs);
}
