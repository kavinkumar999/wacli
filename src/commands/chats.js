// `wa chats [--limit N]` — list recent chats (best-effort).
//
// Baileys removed its built-in store, so there's no persistent chat list to read.
// What we CAN do is listen to the `messaging-history.set` events WhatsApp sends
// during the initial app-state sync right after connecting, collect the chats
// they carry for a short window, then print the most recent ones. Coverage
// depends on what the phone decides to sync, so treat this as a discovery aid
// (use `wa groups` for a reliable group list).

import { authDir, hasSession } from '../lib/auth.js';
import { printBanner } from '../lib/cli-print.js';
import { isGroupJid } from '../lib/jid.js';
import { sleep } from '../lib/util.js';
import { connectWithRetry } from '../lib/whatsapp.js';

const COLLECT_MS = 8_000;

function parse(args) {
  let limit = 30;
  const i = args.findIndex((a) => a === '--limit' || a === '-n');
  if (i !== -1 && args[i + 1]) limit = Math.max(1, Number(args[i + 1]) || limit);
  return { limit };
}

function tsToString(ts) {
  if (!ts) return '';
  const n = typeof ts === 'object' && ts.toNumber ? ts.toNumber() : Number(ts);
  if (!n) return '';
  return new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 16);
}

export async function run(args) {
  const { limit } = parse(args);
  if (!(await hasSession())) throw new Error('Not linked. Run `wa link` first.');

  const byJid = new Map();

  const sock = await connectWithRetry(authDir(), {
    onSock: (sock) => {
      sock.ev.on('messaging-history.set', ({ chats = [] }) => {
        for (const c of chats) {
          if (!c?.id) continue;
          const prev = byJid.get(c.id);
          // Keep the entry with the newer conversation timestamp.
          if (!prev || Number(c.conversationTimestamp || 0) >= Number(prev.conversationTimestamp || 0)) {
            byJid.set(c.id, c);
          }
        }
      });
    },
  });

  try {
    console.log(`Collecting chat history for ${COLLECT_MS / 1000}s…`);
    await sleep(COLLECT_MS);

    const chats = [...byJid.values()].sort(
      (a, b) => Number(b.conversationTimestamp || 0) - Number(a.conversationTimestamp || 0)
    );

    printBanner(`Recent chats (${Math.min(limit, chats.length)} of ${chats.length})`, '💬');
    if (chats.length === 0) {
      console.log('  No chat history was synced. Try again, or use `wa groups`.\n');
      return;
    }
    for (const c of chats.slice(0, limit)) {
      const kind = isGroupJid(c.id) ? '👥' : '👤';
      const name = c.name || c.id;
      const when = tsToString(c.conversationTimestamp);
      console.log(`  ${kind} ${name}`);
      console.log(`     jid: ${c.id}${when ? `   last: ${when}` : ''}`);
    }
    console.log('');
  } finally {
    await sleep(300);
    sock.end(undefined);
  }
  process.exit(0);
}
