// `wa link [--fresh]` — pair this device with WhatsApp via a terminal QR code.
//
// Run once. The session is written into the local auth folder (see lib/auth.js);
// after that, every other command reuses it until WhatsApp drops the linked
// device, at which point you link again. `--fresh` wipes any existing session
// first for a clean QR.
//
// On success we sleep briefly (let the final creds.update flush) then exit(0):
// Baileys leaves timers/sockets open and would otherwise hang the terminal.

import QRCode from 'qrcode';
import { authDir, clearSession, ensureAuthDir } from '../lib/auth.js';
import { printCliFailure } from '../lib/cli-print.js';
import { sleep } from '../lib/util.js';
import { connectWithRetry } from '../lib/whatsapp.js';

const LOGGED_OUT_MESSAGE = [
  'WhatsApp ended linking as "logged out" (session rejected). Try, in order:',
  '  1) Clean slate, then link again:   wa link --fresh',
  '  2) Scan the QR the moment it appears (it refreshes every few seconds)',
  '  3) In WhatsApp → Linked devices, remove old "Chrome"/desktop sessions if at the device limit',
].join('\n');

async function printQr(qr) {
  console.log('\n=============================================');
  console.log('  Scan with WhatsApp → Linked devices → Link a device');
  console.log('=============================================\n');
  console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
  console.log('');
}

export async function run(args) {
  const fresh = args.includes('--fresh');

  if (fresh) {
    await clearSession();
    console.warn('--fresh: cleared the existing local session.\n');
  }
  const dir = await ensureAuthDir();

  const sock = await connectWithRetry(dir, {
    onSocket: async (sock) => {
      if (sock.authState.creds.registered) return;
      console.log('Waiting for QR… (if nothing appears, widen your terminal)\n');
    },
    onConnectionUpdate: (update) => {
      if (update.qr) {
        void printQr(update.qr).catch((err) => {
          printCliFailure(err, {
            title: 'Could not render the QR in this terminal',
            titleIcon: '📱',
          });
        });
      }
    },
    loggedOutMessage: LOGGED_OUT_MESSAGE,
  });

  const me = sock.user?.id || 'unknown';
  console.log(`\nConnected as ${me}. Session saved to ${authDir()}.`);
  await sleep(2_000); // let the final creds.update flush to disk
  sock.end(undefined);
  console.log('Done — you can now use `wa send`, `wa chats`, `wa groups`, `wa watch`.');
  // Baileys can leave timers/sockets open; force a clean exit so the shell returns.
  process.exit(0);
}
