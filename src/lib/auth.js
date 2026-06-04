// Where the linked-device session lives on disk.
//
// Unlike cronwhats (which snapshots the Baileys auth folder into Upstash Redis so
// CI stays stateless), this CLI keeps everything local: Baileys' multi-file auth
// state writes straight into this folder and reads from it on the next run.
//
// Default: ./auth_info in the current working directory. Override with WA_AUTH_DIR
// (e.g. export WA_AUTH_DIR=~/.wacli/auth_info to share one session across folders).

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

/** Absolute path to the auth folder (honors WA_AUTH_DIR, expands a leading ~). */
export function authDir() {
  const configured = process.env.WA_AUTH_DIR;
  if (configured && configured.trim()) {
    const expanded = configured.startsWith('~')
      ? path.join(os.homedir(), configured.slice(1))
      : configured;
    return path.resolve(expanded);
  }
  return path.resolve(process.cwd(), 'auth_info');
}

/** Ensure the auth folder exists; returns its path. */
export async function ensureAuthDir() {
  const dir = authDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** True if a session has been linked (creds.json present and non-empty). */
export async function hasSession() {
  try {
    const stat = await fs.stat(path.join(authDir(), 'creds.json'));
    return stat.size > 0;
  } catch {
    return false;
  }
}

/** Delete the local auth folder (logout). Safe if it's already gone. */
export async function clearSession() {
  await fs.rm(authDir(), { recursive: true, force: true });
}
