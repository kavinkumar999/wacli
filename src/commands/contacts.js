// `wa contacts [sync | list | <query…>]` — manage the local contact cache.
//
//   wa contacts sync [--full]   pull names from WhatsApp into ~/.wacli/contacts.json
//   wa contacts list            print every cached contact (offline)
//   wa contacts <name>          preview which contacts a name resolves to (offline)
//
// `--full` also ingests recent 1:1 chat display names (people you've messaged).
// Saved phone-book names still need those people in your phone's address book;
// if sync stays at 1 contact, run `wa link --fresh` once (fixes Bad MAC / stale keys).

import { authDir, hasSession } from '../lib/auth.js';
import { printBanner } from '../lib/cli-print.js';
import { isLidJid } from '../lib/jid.js';
import {
  attachContactCapture,
  loadContacts,
  pullContacts,
  saveContacts,
  searchContacts,
} from '../lib/contacts-store.js';
import { sleep } from '../lib/util.js';
import { connectWithRetry } from '../lib/whatsapp.js';

const POST_RESYNC_MS = 5_000;
const FULL_SYNC_MS = 25_000;

/** name — +number, sorted by name. */
function printList(entries) {
  for (const e of entries) {
    const label = e.name || e.notify || e.jid;
    console.log(`  👤  ${label}`);
    if (e.number) console.log(`      +${e.number}`);
    else if (e.lid || isLidJid(e.jid)) console.log(`      (WhatsApp ID — send by name)`);
    else console.log(`      ${e.jid}`);
  }
  console.log('');
}

function printSyncHints(total) {
  if (total === 0) {
    console.log('  Nothing synced. Try, in order:');
    console.log('    wa contacts sync --full   include recent chat names');
    console.log('    wa link --fresh           re-pair (imports phone address book)');
    console.log('  Or send by number: wa send 919876543210 "hi"');
  } else if (total === 1) {
    console.log('  Only one person cached. If you expected more:');
    console.log('    • Run `wa contacts sync --full` (includes recent chat names)');
    console.log('    • Saved phone-book names need `wa link --fresh` after linking');
    console.log('    • People only in groups should appear after this sync — try again');
    console.log('  Phone-book names ≠ everyone you chat with on WhatsApp.');
  }
}

async function runSync(syncArgs) {
  const full = syncArgs.includes('--full');
  const map = await loadContacts();
  const before = Object.keys(map).length;

  const sock = await connectWithRetry(authDir(), {
    quiet: true,
    // Attach before history streams in (Baileys waits up to ~20s when this is set).
    onSock: (s) => attachContactCapture(s, map),
    ...(full ? { shouldSyncHistoryMessage: () => true } : {}),
  });

  try {
    console.log(
      full
        ? 'Syncing address book, groups, and recent chats (up to 25s)…'
        : 'Syncing saved contact names + group members from WhatsApp…',
    );
    await pullContacts(sock, map, {
      waitMs: full ? FULL_SYNC_MS : POST_RESYNC_MS,
      attach: false,
      replayNames: true,
    });
    await saveContacts(map);
    const total = Object.keys(map).length;
    printBanner('Contacts synced', '📇');
    console.log(`  ${total} contacts cached (${total - before} new/updated this run).`);
    printSyncHints(total);
    console.log('');
  } finally {
    await sleep(300);
    sock.end(undefined);
  }
}

async function runList() {
  const map = await loadContacts();
  const entries = Object.values(map).sort((a, b) =>
    String(a.name || a.notify).localeCompare(String(b.name || b.notify))
  );
  printBanner(`Cached contacts (${entries.length})`, '📇');
  if (entries.length === 0) {
    console.log('  No contacts cached yet. Run `wa contacts sync --full` first.\n');
    return;
  }
  printList(entries);
}

async function runSearch(query) {
  const map = await loadContacts();
  const hits = searchContacts(map, query);
  printBanner(`Matches for "${query}" (${hits.length})`, '🔎');
  if (hits.length === 0) {
    console.log('  No matches. Run `wa contacts sync --full`, or check the spelling.\n');
    return;
  }
  printList(hits);
}

export async function run(args) {
  if (!(await hasSession())) throw new Error('Not linked. Run `wa link` first.');

  const [sub, ...rest] = args;

  if (sub === 'sync') {
    await runSync(rest);
  } else if (sub === 'list' || !sub) {
    await runList();
  } else {
    // Anything else is treated as a search query (offline preview).
    await runSearch([sub, ...rest].join(' '));
  }

  process.exit(0);
}
