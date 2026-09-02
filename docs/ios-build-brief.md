# Brief: build the mobile app onto a physical iPhone

For an agent picking this up cold. Read [`../README.md`](../README.md) first for what this fork is.

**Repo:** `/Users/macbook/Documents/Zerops-MCP/z3` · branch `main` (tracks
`origin/main` = `git@github.com:zeropsio/mate.git` — the only remote; `krls2020/z3` was archived
2026-08-30)
**App:** `apps/mobile` — Expo / React Native, package `@t3tools/mobile`, Expo SDK-managed (no
`ios/` dir checked in; `expo prebuild` generates it).

---

## Read this before running anything

Four things will stop you. They are all resolvable, but not by guessing.

**1. Xcode is installed but not selected.** `/Applications/Xcode.app` exists, yet
`xcode-select -p` points at `/Library/Developer/CommandLineTools`. Native builds need full Xcode:

```bash
sudo xcode-select -s /Applications/Xcode.app     # needs the user's sudo — ask, do not assume
xcodebuild -version                              # verify before continuing
```

**2. CocoaPods is not installed.** `expo prebuild` for iOS needs it (`brew install cocoapods`).

**3. Do not use EAS.** `apps/mobile/app.config.ts` has `owner: "pingdotgg"` and
`extra.eas.projectId: "d763fcb8-…"` — that Expo project belongs to upstream, not to us. Every
`eas build` script in `package.json` will fail or push to someone else's project. `eas-cli` is not
installed either. **Build locally** (`expo run:ios`).

**4. The bundle identifiers are not ours.** The variants declare `com.t3tools.t3code[.dev]` and
`associatedDomains` for `clerk.t3.codes`. You cannot sign those with our Apple ID.

---

## The sanctioned route: personal-team build

Upstream already built an escape hatch for exactly this — a free-Apple-ID build with your own
bundle id. Use it rather than editing `app.config.ts`.

Create `.env` at the **repo root** (gitignored; `app.config.ts` reads it via `loadRepoEnv`, which
merges `.env` and `.env.local`):

```bash
T3CODE_IOS_PERSONAL_TEAM=1
T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=cz.krls.z3      # any reverse-DNS you control
```

The config validates this: with `T3CODE_IOS_PERSONAL_TEAM=1` and a missing or malformed id it
throws with the reason. The id then replaces `iosBundleIdentifier` for whichever variant you build.

Then:

```bash
nvm use 24.19.0                                   # repo requires node ^24.13.1
export PATH="$HOME/.local/share/vite-plus/bin:$PATH"
vp i                                              # already done once in this checkout
cd apps/mobile
APP_VARIANT=development EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean --platform ios
npx expo run:ios --device                         # pick the connected iPhone
```

`package.json` also has `ios:dev` / `ios:preview` / `ios:prod` wrappers that do prebuild + run in
one step. Variants: `development` (scheme `t3code-dev`), `preview`, `production`.

First run on a device also needs, in Xcode: a signing team (free Apple ID works), and on the phone
**Settings → General → VPN & Device Management → trust the developer certificate**. A free
personal team certificate expires after 7 days — the app then stops launching until rebuilt.

---

## What this app actually is — do not expect it to work alone

The mobile app is a **client**. It has no agent and no server in it; it connects over WebSocket to
a running server and drives whatever that server owns. So a successful build shows a pairing
screen, nothing more, until you point it at a server.

Two servers you can point it at:

- **The Zerops container (the interesting one).** Public HTTPS, reachable from a phone on cellular
  with no VPN: `https://zcp-2333-8080.prg1.zerops.app` (eval project). It sits behind zcp's cookie
  gate, then the T3 server. Confirm it is serving before blaming the app.
- **The local dev server.** `vp run dev` at the repo root, web on `:5733`, server on `:13773` —
  LAN only, and the phone must be on the same network. Note the dev web server binds **IPv6
  loopback only**, so a LAN URL needs the server, not the vite port.

Pairing differs by server: on a Zerops project, sign-in goes through the identity door — no
pairing code, no shared secret (`../zcp/docs/spec-z3.md` §3–§4). The one-time pairing code stays
only for a non-Zerops server (the local dev server above), minted with
`node apps/server/src/bin.ts pair`.

---

## What is NOT done on mobile — expect leftover T3 naming

The mark is shared: mobile renders `ZEROPS_MARK` through
`apps/mobile/src/components/ZeropsMark.tsx`, and `scripts/export-brand-icons.ts` generates every
icon — macOS included, through Xcode's `actool` — with no GUI step left. What remains is naming and
color, and that is unfinished work rather than a bug:

- app names are still `T3 Code` / `T3 Code Dev` (`VARIANT_CONFIG` in `app.config.ts`)
- mobile does **not** use the `zerops` theme. It has its own hand-tuned palette in
  `apps/mobile/src/lib/mobileDefaultTheme.ts` (id `t3-code`, plain hex, not the OKLCH role system
  the web themes use), so porting the Zerops teal there is a separate job

If asked to finish the mobile rebrand, treat it as its own task and keep it additive, like the web
side.

---

## Ground rules

- **Fork rules apply** — see `docs/internals/zerops/fork.md` for what's owned, ported, or
  imported. Prefer `.env` and new files over editing `app.config.ts`.
- **Never rename** the `t3code://` URL schemes casually — the dev client launches through
  `t3code-dev`, and the scheme is also registered with Clerk for OAuth callbacks.
- **Do not commit `.env`** (already gitignored) or any signing asset.
- Report honestly what you did not verify. A build that compiles is not a build that launched on
  the phone, and a launch is not a paired session.
