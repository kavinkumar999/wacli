# wacli

WhatsApp from the command line. Pair once via a QR code, then send messages and
files, list your chats and groups, and watch incoming messages — all from your
terminal. Built on [Baileys](https://github.com/WhiskeySockets/Baileys); the
linked-device session is stored **locally** (no database).

**Stack:** Node 20+ · ES modules · `@whiskeysockets/baileys` 6.x · `qrcode` · `pino`

> Reuses the proven Baileys connection layer from the sibling `cronwhats` project
> (the 515 "restart required" retry handshake, QR link flow, JID formatting), but
> drops Redis and the message-rotation/cron machinery in favour of an interactive,
> on-demand CLI with a local session.

---

## Install

```bash
cd wacli
npm install
# optional: put `wa` on your PATH globally
npm link          # then you can run `wa ...` anywhere; otherwise use `node bin/wa.js ...`
```

## Quick start

```bash
wa link                              # scan the QR from WhatsApp → Linked devices
wa status                            # confirm it's connected
wa send 919876543210 "hello!"        # send a text
wa send 919876543210 "pic" --file ./photo.png   # send a file (text = caption)
wa groups                            # list your groups (and their jids)
wa watch                             # stream incoming messages (Ctrl-C to stop)
```

## Commands

| Command | Description |
| --- | --- |
| `wa link [--fresh]` | One-time pairing via terminal QR. `--fresh` wipes any existing session first. |
| `wa status` | Reports whether a session is linked and verifies it can connect. |
| `wa send <to> <message…> [--file <path>]` | Send text and/or a file. With `--file`, the message becomes the caption; media type (image/video/audio/document) is inferred from the extension. |
| `wa chats [--limit N]` | List recent chats. **Best-effort** (see note). |
| `wa groups` | List every group the account is in, with jids and participant counts. Reliable. |
| `wa watch [--from <to>]` | Stream incoming messages until Ctrl-C. `--from` filters to one chat. |
| `wa logout` | Delete the local session. (Also remove the device in WhatsApp to fully revoke.) |

`<to>` is an **international number** (digits, with country code — e.g. `919876543210`)
or a **group jid** ending in `@g.us` (get one from `wa groups`).

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `WA_AUTH_DIR` | `./auth_info` | Where the session is stored. Set to e.g. `~/.wacli/auth_info` to share one session across directories. A leading `~` is expanded. |
| `LOG_LEVEL` | `silent` | Baileys/pino log level; try `debug` when diagnosing. |
| `DEBUG` | — | Set to `1` to print stack traces on errors. |

## Notes & limits

- **`wa chats` is best-effort.** Baileys has no built-in store, so the chat list is
  assembled from the `messaging-history.set` sync WhatsApp sends right after
  connecting — coverage depends on what your phone syncs. Use `wa groups` for a
  reliable group list.
- **Unofficial client.** WhatsApp can restrict or ban numbers using unofficial Web
  clients. Prefer a dedicated/test number and keep volume low.
- **Linking.** WhatsApp on the phone → **Settings → Linked devices → Link a device →
  Scan QR**. If the QR never appears, widen the terminal. If linking is rejected as
  "logged out", run `wa link --fresh` and scan quickly; remove stale "Chrome" devices
  if you're at the linked-device limit.
- **Node ≥ 20** required.

## Security

This is a **public** repo, and the linked-device session in `auth_info/` grants
**full access to the WhatsApp account** — treat it like a password.

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
  jid.js                  number/group → JID formatting
  cli-print.js            framed error/banner output
  util.js                 sleep
src/commands/
  link.js status.js send.js chats.js groups.js watch.js logout.js
```
