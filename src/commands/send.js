// `wa send <to> <message...> [--file <path>]`
//
//   wa send 919876543210 "hello there"
//   wa send 919876543210 "see attached" --file ./photo.png
//   wa send 12036..@g.us "message to a group"
//
// <to> is an international number (digits, with country code) or a group jid
// (…@g.us). With --file the message text becomes the media caption; the media
// type (image/video/audio/document) is inferred from the file extension.
//
// This is the scriptable, one-shot path. For an interactive picker, see
// `wa ui` (src/commands/ui.js) — both share src/lib/send-core.js.

import path from 'path';
import { authDir, hasSession } from '../lib/auth.js';
import { resolveRecipient, sendTo } from '../lib/send-core.js';
import { sleep } from '../lib/util.js';
import { connectWithRetry } from '../lib/whatsapp.js';

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

  if (!to) throw new Error('Usage: wa send <name|number|jid> <message...> [--file <path>]');
  if (!text && !file) throw new Error('Nothing to send: provide a message, a --file, or both.');
  if (!(await hasSession())) throw new Error('Not linked. Run `wa link` first.');

  // Resolve a contact name -> recipient offline first, so a bad/ambiguous name
  // fails before we bother connecting. Numbers and jids pass straight through.
  const recipient = await resolveRecipient(to);
  if (recipient.matched) {
    const suffix = recipient.number ? ` (+${recipient.number})` : '';
    console.log(`Resolved "${to}" → ${recipient.name}${suffix}`);
  }

  const sock = await connectWithRetry(authDir());
  try {
    const target = await sendTo(sock, recipient.to, { text, file });
    console.log(`sent → ${target}${file ? `  (${path.basename(file)})` : ''}`);
  } finally {
    await sleep(1_000); // let the send + creds flush before we tear down
    sock.end(undefined);
  }
  process.exit(0);
}
