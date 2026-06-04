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
  chats: 'chats',
  groups: 'groups',
  watch: 'watch',
  logout: 'logout',
};

const USAGE = `
  wacli — WhatsApp from the command line

  Usage: wa <command> [args]

  Commands:
    link [--fresh]                 Pair this device via a terminal QR code
    status                         Show whether a session is linked and connects
    send <to> <message> [--file p] Send text (and/or a file) to a number or group
    chats [--limit N]              List recent chats (best-effort)
    groups                         List groups you're a member of
    watch [--from <to>]            Stream incoming messages until Ctrl-C
    logout                         Remove the local session

  <to> is an international number (e.g. 919876543210) or a group jid (…@g.us).
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
