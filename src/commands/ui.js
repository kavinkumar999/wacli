// `wa ui [number|jid]` — interactive, SEND-ONLY WhatsApp UI (ink).
//
// A full-screen terminal picker for sending messages and files. It NEVER reads,
// stores, or displays incoming messages — it only sends. Flow:
//
//   1. Pick a recipient: search/select a contact or group, or type any number.
//   2. Compose: type a message, optionally attach a file (Tab).
//   3. Send. Then send another, or quit.
//
// Recipient candidates are cached contacts (synced on connect), your groups
// (fetched live), and any number you type. Nothing about your chat history is
// ever loaded.
//
// Shares the exact send path with `wa send` via src/lib/send-core.js.

import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { createElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import htm from 'htm';
import { authDir, hasSession } from '../lib/auth.js';
import { isGroupJid, looksNumeric } from '../lib/jid.js';
import { attachContactCapture, loadContacts, pullContacts, saveContacts } from '../lib/contacts-store.js';
import { sendTo } from '../lib/send-core.js';
import { sleep } from '../lib/util.js';
import { connectWithRetry } from '../lib/whatsapp.js';

const html = htm.bind(createElement);
const h = createElement;

const VISIBLE = 8; // rows of the recipient list shown at once
const CONTACT_REFRESH_MS = 2_000;

function sortContacts(map) {
  return Object.values(map).sort((a, b) =>
    String(a.name || a.notify).localeCompare(String(b.name || b.notify))
  );
}

async function fetchGroups(sock) {
  try {
    const map = await sock.groupFetchAllParticipating();
    return Object.values(map)
      .map((g) => ({ id: g.id, subject: g.subject || g.id, participants: g.participants?.length }))
      .filter((g) => isGroupJid(g.id))
      .sort((a, b) => String(a.subject).localeCompare(String(b.subject)));
  } catch {
    return [];
  }
}

/** Connect, pull groups, and refresh the contact cache — all before the picker opens. */
async function bootstrapSession(onPhase) {
  onPhase?.('connecting');
  const contactMap = await loadContacts();
  const sparse = Object.keys(contactMap).length <= 2;

  const sock = await connectWithRetry(authDir(), {
    quiet: true,
    onSock: (s) => attachContactCapture(s, contactMap),
    ...(sparse ? { shouldSyncHistoryMessage: () => true } : {}),
  });

  onPhase?.('syncing');
  const waitMs = sparse ? 20_000 : CONTACT_REFRESH_MS;
  await pullContacts(sock, contactMap, { waitMs, attach: false });
  await saveContacts(contactMap);

  const groups = await fetchGroups(sock);

  return { sock, groups, contacts: sortContacts(contactMap) };
}

function Header() {
  return html`
    <${Box} marginBottom=${1}>
      <${Text} backgroundColor="green" color="black"> 📤 wacli — send </${Text}>
      <${Text} dimColor>  (send-only · nothing is received or stored)</${Text}>
    </${Box}>
  `;
}

// ── Recipient picker ────────────────────────────────────────────────────────
function RecipientPicker({ groups, contacts, onPick }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  // Build the option list from the current query.
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = query.replace(/[^0-9]/g, '');
    const head = looksNumeric(query)
      ? { kind: 'number', label: `📱  Send to +${digits}`, to: digits }
      : { kind: 'manual', label: '✏️   Type a phone number…' };
    const people = contacts
      .filter((c) => {
        if (!q) return true;
        return String(c.name || '').toLowerCase().includes(q)
          || String(c.notify || '').toLowerCase().includes(q);
      })
      .map((c) => ({
        kind: 'contact',
        label: `👤  ${c.name || c.notify}`,
        sub: `+${c.number}`,
        to: c.jid,
        name: c.name || c.notify,
      }));
    const filtered = groups
      .filter((g) => !q || String(g.subject).toLowerCase().includes(q))
      .map((g) => ({
        kind: 'group',
        label: `👥  ${g.subject}`,
        sub: `${g.participants ?? '?'} participants`,
        to: g.id,
        name: g.subject,
      }));
    return [head, ...people, ...filtered];
  }, [query, groups, contacts]);

  // Keep the selection in range as the list shrinks/grows.
  const clamped = Math.min(index, options.length - 1);
  useEffect(() => {
    if (index > options.length - 1) setIndex(Math.max(0, options.length - 1));
  }, [options.length, index]);

  useInput((input, key) => {
    if (key.downArrow) setIndex((i) => Math.min(options.length - 1, i + 1));
    else if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.return) {
      const opt = options[clamped];
      if (opt) onPick(opt);
    }
  });

  // Scroll window so the selected row stays visible.
  const start = Math.max(0, Math.min(clamped - Math.floor(VISIBLE / 2), Math.max(0, options.length - VISIBLE)));
  const window = options.slice(start, start + VISIBLE);

  return html`
    <${Box} flexDirection="column">
      <${Box}>
        <${Text} color="green">Search contacts / groups: </${Text}>
        <${TextInput} value=${query} onChange=${setQuery} placeholder="name, group, or number…" />
      </${Box}>
      ${contacts.length === 0 && !query.trim() ? html`
        <${Box} marginTop=${1}><${Text} dimColor>No contacts cached yet — type a number, or run \`wa contacts sync\`.</${Text}></${Box}>
      ` : ''}
      <${Box} flexDirection="column" marginTop=${1}>
        ${window.map((opt, i) => {
          const realIdx = start + i;
          const selected = realIdx === clamped;
          return html`
            <${Box} key=${realIdx}>
              <${Text} color=${selected ? 'black' : undefined} backgroundColor=${selected ? 'green' : undefined}>
                ${selected ? '❯ ' : '  '}${opt.label}${opt.sub ? html`<${Text} dimColor> — ${opt.sub}</${Text}>` : ''}
              </${Text}>
            </${Box}>
          `;
        })}
      </${Box}>
      <${Box} marginTop=${1}>
        <${Text} dimColor>↑/↓ select · Enter choose · Ctrl-C quit${options.length > VISIBLE ? `  ·  ${clamped + 1}/${options.length}` : ''}${contacts.length || groups.length ? `  ·  ${contacts.length} contact${contacts.length === 1 ? '' : 's'}, ${groups.length} group${groups.length === 1 ? '' : 's'}` : ''}</${Text}>
      </${Box}>
    </${Box}>
  `;
}

// ── Manual number entry ───────────────────────────────────────────────────────
function ManualEntry({ onSubmit, onBack }) {
  const [value, setValue] = useState('');
  useInput((input, key) => {
    if (key.escape) onBack();
  });
  return html`
    <${Box} flexDirection="column">
      <${Text} color="green">Phone number (with country code, e.g. 919876543210):</${Text}>
      <${Box}>
        <${Text}>› </${Text}>
        <${TextInput}
          value=${value}
          onChange=${setValue}
          onSubmit=${(v) => v.trim() && onSubmit(v.trim())}
          placeholder="digits only"
        />
      </${Box}>
      <${Box} marginTop=${1}><${Text} dimColor>Enter confirm · Esc back</${Text}></${Box}>
    </${Box}>
  `;
}

// ── Compose screen ────────────────────────────────────────────────────────────
function Composer({ recipient, onSend, onBack }) {
  const [field, setField] = useState('message'); // 'message' | 'file'
  const [message, setMessage] = useState('');
  const [file, setFile] = useState('');

  useInput((input, key) => {
    if (key.escape) return onBack();
    // Tab toggles between the message and attachment fields. (ink-text-input
    // ignores Tab, so it won't leak into whichever field is focused — unlike a
    // letter-based chord such as Ctrl-F, which the input would insert.)
    if (key.tab) setField((f) => (f === 'message' ? 'file' : 'message'));
  });

  const submit = () => {
    const text = message.trim();
    const attach = file.trim();
    if (!text && !attach) return; // nothing to send
    onSend({ text: text || undefined, file: attach || undefined });
  };

  return html`
    <${Box} flexDirection="column">
      <${Box}>
        <${Text} dimColor>To: </${Text}><${Text} color="cyan">${recipient.name || recipient.to}</${Text}>
      </${Box}>
      <${Box} marginTop=${1}>
        <${Text} color=${field === 'message' ? 'green' : undefined}>${field === 'message' ? '❯ ' : '  '}Message: </${Text}>
        <${TextInput}
          value=${message}
          onChange=${setMessage}
          focus=${field === 'message'}
          onSubmit=${submit}
          placeholder="type your message…"
        />
      </${Box}>
      <${Box}>
        <${Text} color=${field === 'file' ? 'green' : undefined}>${field === 'file' ? '❯ ' : '  '}Attach:  </${Text}>
        <${TextInput}
          value=${file}
          onChange=${setFile}
          focus=${field === 'file'}
          onSubmit=${submit}
          placeholder="(optional) path to image/file"
        />
      </${Box}>
      <${Box} marginTop=${1} flexDirection="column">
        <${Text} dimColor>Tab switch message/attach · Enter send · Esc back</${Text}>
        ${file.trim() ? html`<${Text} dimColor>Attachment: ${file.trim()} (message becomes the caption)</${Text}>` : ''}
      </${Box}>
    </${Box}>
  `;
}

// ── Sending / result ──────────────────────────────────────────────────────────
function Spinner() {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, []);
  return html`<${Text} color="green">${frames[i]}</${Text}>`;
}

function Result({ result, onNew, onQuit }) {
  useInput((input) => {
    if (input === 'n') onNew();
    else if (input === 'q') onQuit();
  });
  const ok = result.ok;
  return html`
    <${Box} flexDirection="column">
      <${Box}>
        <${Text} color=${ok ? 'green' : 'red'}>${ok ? '✓ Sent' : '✗ Failed'}</${Text}>
        <${Text}> ${ok ? `→ ${result.target}` : ''}</${Text}>
      </${Box}>
      ${!ok ? html`<${Box} marginTop=${1}><${Text} color="red">${result.error}</${Text}></${Box}>` : ''}
      <${Box} marginTop=${1}><${Text} dimColor>[n] send another · [q] quit</${Text}></${Box}>
    </${Box}>
  `;
}

// ── Bootstrap (connect + load lists inside the TUI — no stray stdout) ─────────
function BootError({ message, onQuit }) {
  useInput(() => onQuit());
  return html`
    <${Box} flexDirection="column">
      <${Header} />
      <${Text} color="red">✗ ${message}</${Text}>
      <${Box} marginTop=${1}><${Text} dimColor>Press any key to quit</${Text}></${Box}>
    </${Box}>
  `;
}

function Bootstrap({ initialTo, sockRef }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState('connecting'); // connecting | syncing | error
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const boot = await bootstrapSession((p) => {
          if (!cancelled) setPhase(p);
        });
        if (cancelled) {
          boot.sock.end(undefined);
          return;
        }
        sockRef.current = boot.sock;
        setSession(boot);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setPhase('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sockRef]);

  if (phase === 'error') {
    return html`<${BootError} message=${error} onQuit=${exit} />`;
  }

  if (!session) {
    const message = phase === 'syncing' ? 'Loading contacts & groups…' : 'Connecting…';
    return html`
      <${Box} flexDirection="column">
        <${Header} />
        <${Box}><${Spinner} /><${Text}> ${message}</${Text}></${Box}>
      </${Box}>
    `;
  }

  return html`<${App}
    groups=${session.groups}
    contacts=${session.contacts}
    initialTo=${initialTo}
    onSend=${(to, content) => sendTo(session.sock, to, content)}
    onQuit=${exit}
  />`;
}

// ── Root ──────────────────────────────────────────────────────────────────────
export function App({ groups, contacts, initialTo, onSend, onQuit }) {
  const { exit } = useApp();
  const quit = onQuit || exit;
  const [step, setStep] = useState(initialTo ? 'compose' : 'recipient');
  const [recipient, setRecipient] = useState(initialTo ? { to: initialTo, name: initialTo } : null);
  const [result, setResult] = useState(null);

  const goCompose = (r) => {
    setRecipient(r);
    setStep('compose');
  };

  const handlePick = (opt) => {
    if (opt.kind === 'manual') setStep('manual');
    else goCompose({ to: opt.to, name: opt.name });
  };

  const doSend = async ({ text, file }) => {
    setStep('sending');
    try {
      const target = await onSend(recipient.to, { text, file });
      setResult({ ok: true, target });
    } catch (err) {
      setResult({ ok: false, error: err?.message || String(err) });
    }
    setStep('result');
  };

  const header = html`<${Header} />`;

  let body;
  if (step === 'recipient') body = html`<${RecipientPicker} groups=${groups} contacts=${contacts} onPick=${handlePick} />`;
  else if (step === 'manual') body = html`<${ManualEntry} onSubmit=${(v) => goCompose({ to: v, name: v })} onBack=${() => setStep('recipient')} />`;
  else if (step === 'compose') body = html`<${Composer} recipient=${recipient} onSend=${doSend} onBack=${() => setStep(initialTo ? 'compose' : 'recipient')} />`;
  else if (step === 'sending') body = html`<${Box}><${Spinner} /><${Text}> Sending…</${Text}></${Box}>`;
  else body = html`<${Result} result=${result} onNew=${() => setStep('recipient')} onQuit=${quit} />`;

  return html`<${Box} flexDirection="column">${header}${body}</${Box}>`;
}

export async function run(args) {
  if (!(await hasSession())) throw new Error('Not linked. Run `wa link` first.');
  if (!process.stdin.isTTY) {
    throw new Error('`wa ui` needs an interactive terminal. Use `wa send …` for scripts/pipes.');
  }

  const initialTo = args.find((a) => !a.startsWith('-'));
  const sockRef = { current: null };

  const { waitUntilExit } = render(
    h(Bootstrap, { initialTo, sockRef })
  );

  await waitUntilExit();
  await sleep(1_000); // let the last send + creds flush before teardown
  sockRef.current?.end(undefined);
  process.exit(0);
}
