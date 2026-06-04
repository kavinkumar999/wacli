// `wa status` — report whether a session is linked and that it can connect.
//
// If no local session exists, says so and points at `wa link`. Otherwise it
// opens a connection, prints the linked account's own JID, then closes.

import { authDir, hasSession } from '../lib/auth.js';
import { printBanner } from '../lib/cli-print.js';
import { sleep } from '../lib/util.js';
import { connectWithRetry } from '../lib/whatsapp.js';

export async function run() {
  printBanner('wacli status', '🩺');

  if (!(await hasSession())) {
    console.log('  Session : not linked');
    console.log(`  Auth dir: ${authDir()}`);
    console.log('\n  Run `wa link` to pair a device.\n');
    return;
  }

  console.log('  Session : found, connecting to verify…');
  const sock = await connectWithRetry(authDir());
  try {
    const me = sock.user?.id || 'unknown';
    const name = sock.user?.name ? ` (${sock.user.name})` : '';
    console.log(`  Account : ${me}${name}`);
    console.log(`  Auth dir: ${authDir()}`);
    console.log('  State   : connected ✅\n');
  } finally {
    await sleep(500);
    sock.end(undefined);
  }
  process.exit(0);
}
