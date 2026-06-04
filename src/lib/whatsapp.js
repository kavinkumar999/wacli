// Baileys connection helpers backed by a local auth folder.
//
// Ported from cronwhats. Baileys is event-driven and frequently asks for a
// reconnect right after the first handshake (DisconnectReason.restartRequired =
// 515), so we open in a loop and recreate the socket on that code. `openOnce`
// opens a single socket and resolves when it opens or closes; `connectWithRetry`
// drives the retry loop and is what every command should use.

import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { sleep } from './util.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

/**
 * Open a Baileys socket once.
 * @param {string} authDir - local folder holding the auth state.
 * @param {(sock: any) => Promise<void>} [onSocket] - optional hook called right
 *        after socket creation, before the connection opens (used by `link` to
 *        log while waiting for QR).
 * @param {{ onConnectionUpdate?: (update: any) => void, onSock?: (sock: any) => void }} [options]
 *        `onConnectionUpdate` receives every connection.update (e.g. to print QR
 *        from `update.qr`); `onSock` gets the socket so callers can attach their
 *        own event listeners (e.g. messages.upsert) before it opens.
 * @returns {Promise<{ sock: any, status: 'open' | 'close', code?: number }>}
 */
export async function openOnce(authDir, onSocket, options) {
  const { onConnectionUpdate, onSock } = options ?? {};
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    // Match a normal WhatsApp Web client (Baileys default). A custom label is
    // easy for the server to flag and reject during QR link.
    browser: Browsers.appropriate('Chrome'),
  });

  // Persist credential changes to the folder as they happen.
  sock.ev.on('creds.update', saveCreds);

  if (onSock) onSock(sock);
  if (onSocket) await onSocket(sock);

  return await new Promise((resolve) => {
    sock.ev.on('connection.update', (update) => {
      onConnectionUpdate?.(update);
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        resolve({ sock, status: 'open' });
      } else if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        resolve({ sock, status: 'close', code });
      }
    });
  });
}

/**
 * Open a connection, retrying through the normal restart-required handshake.
 * Throws a clear error if WhatsApp logs the session out, or if all attempts fail.
 *
 * @param {string} authDir
 * @param {object} [options]
 * @param {(sock: any) => Promise<void>} [options.onSocket]
 * @param {(update: any) => void} [options.onConnectionUpdate]
 * @param {(sock: any) => void} [options.onSock]
 * @param {number} [options.maxAttempts=5]
 * @param {number} [options.retryDelayMs=2000]
 * @param {string} [options.loggedOutMessage]
 * @returns {Promise<any>} the open socket (caller owns it and must `sock.end()`).
 */
export async function connectWithRetry(authDir, options = {}) {
  const {
    onSocket,
    onConnectionUpdate,
    onSock,
    maxAttempts = 5,
    retryDelayMs = 2_000,
    loggedOutMessage = 'Session logged out by WhatsApp. Run `wa link` to re-pair this device.',
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { sock, status, code } = await openOnce(authDir, onSocket, {
      onConnectionUpdate,
      onSock,
    });
    if (status === 'open') return sock;

    sock.end(undefined);
    if (code === DisconnectReason.loggedOut) {
      throw new Error(loggedOutMessage);
    }
    // restartRequired (515) right after pairing is normal — recreate and continue.
    console.warn(`connect attempt ${attempt} closed (code ${code}); retrying...`);
    await sleep(retryDelayMs);
  }

  throw new Error(`Could not establish a connection after ${maxAttempts} attempts`);
}
