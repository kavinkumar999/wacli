// Where the linked-device session lives on disk.
//
// Unlike cronwhats (which snapshots the Baileys auth folder into Upstash Redis so
// CI stays stateless), this CLI keeps everything local: Baileys' multi-file auth
// state writes straight into this folder and reads from it on the next run.
//
// Default: ~/.wacli/auth_info — a STABLE per-machine location, so the session is
// the same no matter which directory you run `wa` from (and it's well outside the
// repo). Override with WA_AUTH_DIR to point somewhere else.
//
// Multiple laptops: WhatsApp multi-device links each device separately (up to 4),
// so run `wa link` once on each machine — each gets its own session here. Do NOT
// share one auth folder between two machines running at the same time; that causes
// logouts/conflicts.

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

/** Default per-machine session location when WA_AUTH_DIR is not set. */
const DEFAULT_AUTH_DIR = path.join(os.homedir(), '.wacli', 'auth_info');

/** Absolute path to the auth folder (honors WA_AUTH_DIR, expands a leading ~). */
export function authDir() {
  const configured = process.env.WA_AUTH_DIR;
  if (configured && configured.trim()) {
    const expanded = configured.startsWith('~')
      ? path.join(os.homedir(), configured.slice(1))
      : configured;
    return path.resolve(expanded);
  }
  return DEFAULT_AUTH_DIR;
}

/** Ensure the auth folder exists; returns its path. */
export async function ensureAuthDir() {
  const dir = authDir();
  const parent = path.dirname(dir);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(parent, 0o700).catch(() => {});
  await fs.chmod(dir, 0o700).catch(() => {});
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
