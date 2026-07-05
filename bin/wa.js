#!/usr/bin/env node
// wacli entrypoint: route `wa <command> ...` to a command module.
//
// Each command lives in src/commands/<name>.js and exports `run(args)`. We keep
// the dispatch tiny and dependency-free (no CLI framework) — just a name → module
// map, dynamic import, and shared error formatting.

import { printCliFailure } from '../src/lib/cli-print.js';

const COMMANDS = {
  link: 'link',
  status: 'status',
  send: 'send',
  ui: 'ui',
  contacts: 'contacts',
  groups: 'groups',
  logout: 'logout',
};

const USAGE = `
  wacli — WhatsApp from the command line

  Usage: wa <command> [args]

  Commands:
    link [--fresh]                 Pair this device via a terminal QR code
    status                         Show whether a session is linked and connects
    send <to> <message> [--file p] Send text (and/or a file) to a name, number,
                                   or group (resolves a saved contact name)
    ui [number]                    Interactive send-only UI: search a contact or
                                   group, type a message, attach a file
    contacts [sync [--full]|list|<name>]  Contact cache for send-by-name (see sync --full)
    groups                         List groups you're a member of
    logout                         Remove the local session

  <to> is a saved contact name, an international number (e.g. 919876543210), or a
  group jid (…@g.us). Run \`wa contacts sync\` once so names can be resolved.
  Override the session folder with WA_AUTH_DIR. Set DEBUG=1 for stack traces.
`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return;
  }

  const moduleName = COMMANDS[cmd];
  if (!moduleName) {
    console.log(`Unknown command: ${cmd}`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const mod = await import(`../src/commands/${moduleName}.js`);
  await mod.run(args);
}

main().catch((err) => {
  printCliFailure(err, { title: 'Command failed', titleIcon: '📵' });
});
