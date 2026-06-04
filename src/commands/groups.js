// `wa groups` — list every group the linked account participates in.
//
// Reliable: groupFetchAllParticipating() asks the server directly and returns
// metadata for each group, so this doesn't depend on local history sync. Use the
// printed jids (…@g.us) as the <to> for `wa send`.

import { authDir, hasSession } from '../lib/auth.js';
import { printBanner } from '../lib/cli-print.js';
import { sleep } from '../lib/util.js';
import { connectWithRetry } from '../lib/whatsapp.js';

export async function run() {
  if (!(await hasSession())) throw new Error('Not linked. Run `wa link` first.');

  const sock = await connectWithRetry(authDir());
  try {
    const groups = await sock.groupFetchAllParticipating(); // { jid: metadata }
    const list = Object.values(groups).sort((a, b) =>
      String(a.subject).localeCompare(String(b.subject))
    );

    printBanner(`Groups (${list.length})`, '👥');
    if (list.length === 0) {
      console.log('  No groups found for this account.\n');
      return;
    }
    for (const g of list) {
      const count = g.participants?.length ?? '?';
      console.log(`  ${g.subject}`);
      console.log(`    jid: ${g.id}   (${count} participants)`);
    }
    console.log('');
  } finally {
    await sleep(500);
    sock.end(undefined);
  }
  process.exit(0);
}
