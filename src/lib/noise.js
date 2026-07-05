// Filter libsignal/Baileys crypto chatter from the terminal.
//
// libsignal logs decrypt retries and session bookkeeping straight to console.*
// (not via pino), which floods commands like `wa contacts sync`. We keep the
// real console methods but drop known-harmless noise unless DEBUG=1.

const NOISE = [
  /Failed to decrypt message/i,
  /Session error/i,
  /Bad MAC/i,
  /Decrypted message with closed session/i,
  /Closing open session/i,
  /Closing session:/i,
  /Opening session:/i,
  /Session already (closed|open)/i,
  /Removing old closed session/i,
  /V1 session storage migration error/i,
  /Unhandled bucket type/i,
];

function isNoise(args) {
  const text = args
    .map((a) => (typeof a === 'string' ? a : a?.message ?? String(a)))
    .join(' ');
  return NOISE.some((re) => re.test(text));
}

let depth = 0;
let saved = null;

function install() {
  if (saved) return;
  saved = {
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  const filter = (orig) => (...args) => {
    if (isNoise(args)) return;
    orig.apply(console, args);
  };
  console.error = filter(saved.error);
  console.warn = filter(saved.warn);
  console.info = filter(saved.info);
}

function restore() {
  if (!saved) return;
  console.error = saved.error;
  console.warn = saved.warn;
  console.info = saved.info;
  saved = null;
}

/** Turn on filtering (ref-counted). Skipped when DEBUG=1. */
export function beginNoiseSuppression() {
  if (process.env.DEBUG === '1') return;
  if (depth++ === 0) install();
}

/** Turn off filtering when the last guarded socket closes. */
export function endNoiseSuppression() {
  if (process.env.DEBUG === '1') return;
  if (depth > 0 && --depth === 0) restore();
}

/** Ensure sock.end() always releases suppression. */
export function guardSocket(sock) {
  const origEnd = sock.end?.bind(sock);
  if (!origEnd) return sock;
  let ended = false;
  sock.end = (...args) => {
    if (!ended) {
      ended = true;
      endNoiseSuppression();
    }
    return origEnd(...args);
  };
  return sock;
}
