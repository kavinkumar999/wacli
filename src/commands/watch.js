// `wa watch [--from <number|jid>]` — stream incoming messages to the terminal.
//
// Stays connected and prints each new incoming message (sender, name, text or a
// media tag) until you press Ctrl-C. Pass --from to only show messages from one
// chat. Outgoing messages (fromMe) are ignored.

import { authDir, hasSession } from '../lib/auth.js';
import { printBanner } from '../lib/cli-print.js';
import { toJid } from '../lib/jid.js';
import { connectWithRetry } from '../lib/whatsapp.js';

/** Best-effort human-readable summary of a Baileys message. */
function describe(message) {
  if (!message) return '[no content]';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage) return `[image]${capt(message.imageMessage.caption)}`;
  if (message.videoMessage) return `[video]${capt(message.videoMessage.caption)}`;
  if (message.documentMessage) return `[document: ${message.documentMessage.fileName || '?'}]`;
  if (message.audioMessage) return '[audio]';
  if (message.stickerMessage) return '[sticker]';
  if (message.reactionMessage) return `[reaction: ${message.reactionMessage.text}]`;
  const [type] = Object.keys(message);
  return `[${type || 'unknown'}]`;
}
const capt = (c) => (c ? ` ${c}` : '');

function parse(args) {
  const i = args.findIndex((a) => a === '--from');
  const from = i !== -1 ? args[i + 1] : undefined;
  return { from: from ? toJid(from) : undefined };
}

export async function run(args) {
  const { from } = parse(args);
  if (!(await hasSession())) throw new Error('Not linked. Run `wa link` first.');

  const sock = await connectWithRetry(authDir(), {
    onSock: (sock) => {
      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return; // 'append' = history backfill, skip
        for (const m of messages) {
          if (m.key.fromMe) continue;
          const jid = m.key.remoteJid;
          if (from && jid !== from) continue;
          const who = m.pushName || jid;
          const sender = m.key.participant ? ` ~${m.key.participant.split('@')[0]}` : '';
          const time = new Date().toTimeString().slice(0, 8);
          console.log(`[${time}] ${who}${sender}  (${jid})`);
          console.log(`        ${describe(m.message)}`);
        }
      });
    },
  });

  printBanner(from ? `Watching ${from}` : 'Watching all incoming messages', '👀');
  console.log('  Listening… press Ctrl-C to stop.\n');

  // Keep the process alive; close cleanly on Ctrl-C.
  process.on('SIGINT', () => {
    console.log('\nStopping…');
    sock.end(undefined);
    process.exit(0);
  });
}
