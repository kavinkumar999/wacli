// `wa logout` — delete the local session so the next `wa link` starts fresh.
//
// This only removes the local auth folder; it does NOT remove the linked device
// from your phone. To fully revoke, also open WhatsApp → Linked devices and log
// the "Chrome" device out there.

import { authDir, clearSession, hasSession } from '../lib/auth.js';

export async function run() {
  const linked = await hasSession();
  await clearSession();
  if (linked) {
    console.log(`Removed local session at ${authDir()}.`);
    console.log('Tip: also remove the device in WhatsApp → Linked devices to fully revoke.');
  } else {
    console.log('No local session was present — nothing to remove.');
  }
}
