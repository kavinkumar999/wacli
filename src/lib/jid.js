// Convert a CLI target ("to") into a WhatsApp JID.
//
// Accepts:
//   - a bare international number, digits only or loosely formatted
//     ("919876543210", "+91 98765 43210") -> "<digits>@s.whatsapp.net"
//   - a full user jid ("...@s.whatsapp.net") — passed through
//   - a group jid ("...@g.us") — passed through
//
// Ported from cronwhats' recipients.js (toJid).

/**
 * @param {string} to
 * @returns {string} a WhatsApp JID
 */
export function toJid(to) {
  const raw = String(to ?? '').trim();
  if (!raw) {
    throw new Error('Missing recipient. Pass a number (e.g. 919876543210) or a group jid (…@g.us).');
  }
  if (raw.includes('@')) return raw; // already a jid (group @g.us or full @s.whatsapp.net)

  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) {
    throw new Error(
      `Invalid recipient "${to}": expected a digits-only number (with country code) or a jid ending in @g.us`
    );
  }
  return `${digits}@s.whatsapp.net`;
}

/** True if a jid points at a group. */
export function isGroupJid(jid) {
  return String(jid).endsWith('@g.us');
}
