// Shared "graceful" CLI output: framed errors and section banners, printed to
// stdout (never console.error) so the layout stays consistent across commands.
// Ported from cronwhats. Set DEBUG=1 to append stack traces on failure.

/** Rule width for CLI banners. */
export const CLI_LINE = '─'.repeat(52);

/**
 * Soft-wrap `text` for terminal columns (word boundaries).
 * @param {string} text
 * @param {string} [indent='    ']
 * @param {number} [max=64]
 */
export function wrapDetail(text, indent = '    ', max = 64) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (next.length > max && current) {
      lines.push(indent + current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(indent + current);
  return lines.join('\n');
}

/** Print a framed section header (icon + title + rule). */
export function printBanner(title, icon = '📱') {
  console.log('');
  console.log(`  ${icon}  ${title}`);
  console.log('  ' + CLI_LINE);
  console.log('');
}

/**
 * Print an error to stdout in a consistent, readable layout (no `console.error`).
 * Set `DEBUG=1` to append a stack trace.
 *
 * @param {unknown} err
 * @param {{ banner?: string, title?: string, titleIcon?: string }} [opts]
 */
export function printCliFailure(err, opts = {}) {
  const { banner, title = 'Something went wrong', titleIcon = '❌' } = opts;

  const msg =
    err && typeof err === 'object' && 'message' in err && err.message != null
      ? String(err.message)
      : String(err);
  const stack =
    err && typeof err === 'object' && 'stack' in err && err.stack != null
      ? String(err.stack)
      : '';

  console.log('');
  if (banner) {
    console.log(`  ${banner}`);
    console.log('');
  }
  console.log(`  ${titleIcon}  ${title}`);
  console.log('  ' + CLI_LINE);
  console.log('');
  console.log(wrapDetail(msg));
  if (process.env.DEBUG && stack) {
    console.log('');
    console.log('  🐛  Stack (DEBUG=1)');
    console.log(wrapDetail(stack));
  }
  console.log('');
  console.log('  ' + CLI_LINE);
  console.log('');
  process.exitCode = 1;
}
