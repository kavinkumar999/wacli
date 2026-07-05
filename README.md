# wacli

WhatsApp from the command line. Pair once via a QR code, then send messages and
files and list your groups — all from your terminal. Built on [Baileys](https://github.com/WhiskeySockets/Baileys); the
linked-device session is stored **locally** (no database).

**Stack:** Node 22+ · ES modules · `@whiskeysockets/baileys` 6.x · `qrcode` · `pino`

> Reuses the proven Baileys connection layer from the sibling `cronwhats` project
> (the 515 "restart required" retry handshake, QR link flow, JID formatting), but
> drops Redis and the message-rotation/cron machinery in favour of an interactive,
> on-demand CLI with a local session.

---

## Install

```bash
cd wacli
npm install       # also enables the pre-commit secret guard (via the prepare script)
# if you cloned and the guard isn't active yet:
npm run setup     # enables it: git config core.hooksPath .githooks
# optional: put `wa` on your PATH globally
npm link          # then you can run `wa ...` anywhere; otherwise use `node bin/wa.js ...`
```

## Quick start

```bash
wa link                              # scan the QR from WhatsApp → Linked devices
wa status                            # confirm it's connected
wa contacts sync                     # cache your contacts so you can send by name
wa send "amma" "on my way"           # send by saved contact name
wa send 919876543210 "hello!"        # …or by number
wa send 919876543210 "pic" --file ./photo.png   # send a file (text = caption)
wa ui                                # interactive send: search a contact/group, send
wa groups                            # list your groups (and their jids)
```

## Commands

| Command | Description |
| --- | --- |
| `wa link [--fresh]` | One-time pairing via terminal QR. `--fresh` wipes any existing session first. |
| `wa status` | Reports whether a session is linked and verifies it can connect. |
| `wa send <to> <message…> [--file <path>]` | Send text and/or a file. `<to>` may be a **saved contact name**, a number, or a group jid. With `--file`, the message becomes the caption; media type (image/video/audio/document) is inferred from the extension. |
| `wa ui [number]` | **Interactive, send-only UI** (full-screen). Search/select a **contact** or group (or type any number), compose a message, optionally attach a file (Tab), and send — then send another or quit. Never reads, stores, or shows incoming messages. Needs a real terminal (use `wa send` for scripts/pipes). |
| `wa contacts [sync\|list\|<name>]` | Manage the local contact cache used for send-by-name. `sync` refreshes it from WhatsApp; `list` prints everything cached; `<name>` previews what a name resolves to. All offline except `sync`. |
| `wa groups` | List every group the account is in, with jids and participant counts. Reliable. |
| `wa logout` | Delete the local session. (Also remove the device in WhatsApp to fully revoke.) |

`<to>` is a **saved contact name** (e.g. `"amma"`), an **international number**
(digits, with country code — e.g. `919876543210`), or a **group jid** ending in
`@g.us` (get one from `wa groups`). A name is resolved against the local contact
cache — run `wa contacts sync` first. If a name matches more than one contact,
`wa send` lists the candidates and sends nothing, so you can retype a more specific
name or use the number.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `WA_AUTH_DIR` | `~/.wacli/auth_info` | Where the session is stored. A stable per-machine path, so it's the same regardless of which directory you run `wa` from. A leading `~` is expanded. |
| `LOG_LEVEL` | `silent` | Baileys/pino log level; try `debug` when diagnosing. |
| `DEBUG` | — | Set to `1` to print stack traces on errors. |

### Where the session lives & using multiple machines

The linked-device session is stored at **`~/.wacli/auth_info`** by default — a
fixed location in your home directory, **not** inside this repo and **not** tied to
your current working directory. The repo never contains it. Override the location
with `WA_AUTH_DIR` if you want.

WhatsApp is multi-device: it links **each device separately** (up to 4). To use
`wacli` on more than one laptop, run `wa link` **once on each machine** — each gets
its own session under `~/.wacli/auth_info`. Do **not** copy one `auth_info/` folder
to another laptop and run both at once; concurrent use of a single session causes
logouts and conflicts. (Sharing one identity for non-concurrent automation is what
the sibling `cronwhats` project uses Redis for — out of scope for this CLI.)

## Notes & limits

- **Send-by-name depends on synced contacts.** For the same reason (no built-in
  store), names come from WhatsApp's contact-sync events, cached locally at
  `~/.wacli/contacts.json` (beside the session; moves with `WA_AUTH_DIR`). Every
  command that connects updates the cache in the background, and `wa contacts sync`
  refreshes it on demand. If a contact hasn't synced yet, its name won't resolve —
  run `wa contacts sync` (or just use the number). The cache holds only names and
  numbers; no messages are ever stored.
- **Unofficial client.** WhatsApp can restrict or ban numbers using unofficial Web
  clients. Prefer a dedicated/test number and keep volume low.
- **Linking.** WhatsApp on the phone → **Settings → Linked devices → Link a device →
  Scan QR**. If the QR never appears, widen the terminal. If linking is rejected as
  "logged out", run `wa link --fresh` and scan quickly; remove stale "Chrome" devices
  if you're at the linked-device limit.
- **Node ≥ 22** required.

## Security

Everything sensitive lives under **`~/.wacli/`** (or beside whatever path you set
in `WA_AUTH_DIR`):

| Path | Contents | Risk |
| --- | --- | --- |
| `auth_info/` | Baileys session (`creds.json`, signal keys, …) | **Critical** — full WhatsApp account access, same as a logged-in browser |
| `contacts.json` | Names, numbers, jids for send-by-name | **Moderate** — address-book metadata, no message content |

Recommendations:

- **Treat `auth_info/` like a password.** Anyone who can read it can impersonate
  your linked device. Do not copy it to shared drives, backups without encryption,
  or cloud-sync folders (iCloud/Dropbox/Google Drive often sync `~/`).
- **Restrict filesystem permissions.** On Unix, `~/.wacli` should be `700` and
  files inside `600` so other users on the same machine cannot read them. New
  installs get this automatically; for an existing folder run:
  `chmod 700 ~/.wacli ~/.wacli/auth_info && chmod 600 ~/.wacli/auth_info/* ~/.wacli/contacts.json`
- **No encryption at rest** — data is plain JSON on disk. That is normal for a
  local CLI; if you need stronger protection, point `WA_AUTH_DIR` at an encrypted
  volume (FileVault, LUKS, macOS encrypted sparse bundle, etc.).
- **Contacts are not encrypted either** — only names/numbers for convenience;
  no messages are ever written to disk.
- **Revoke properly** — `wa logout` deletes the local session; also remove the
  linked device in WhatsApp → Linked devices so the keys cannot be reused.

Repo hygiene (unchanged):

- `auth_info/`, `.env*`, and key/cert files are **gitignored**. Never commit them.
- A pre-commit guard refuses to commit those files even if forced. Enable it once
  per clone:

  ```bash
  git config core.hooksPath .githooks
  ```

- The repository contains **no secrets** — verify anytime with:
  `git ls-files | grep -Ei 'auth_info|creds|\.env|\.pem|\.key'` (should be empty).

## License

[MIT](LICENSE) © Kavin Kumar.

## Layout

```
bin/wa.js                 CLI router (name → command module)
src/lib/
  auth.js                 Local session folder (WA_AUTH_DIR), presence checks, clear
  whatsapp.js             connectWithRetry / openOnce (Baileys, ported from cronwhats)
  jid.js                  number/group → JID formatting, name/number heuristic
  send-core.js            shared send path: media shaping, jid + name resolution
  contacts-store.js       persistent contact cache + name matcher
  cli-print.js            framed error/banner output
  util.js                 sleep
src/commands/
  link.js status.js send.js ui.js contacts.js groups.js logout.js
```
