# Design guide

Shared principles and words for every client surface. Domain meanings live in [the primer](primer.md).

## 1. Shared principles

- Content does not move by itself. Transient state stays in a fixed frame.
- A list has an explicit order. Background arrivals do not rearrange the order the person chose.
- Related words share a text edge; related actions share an end edge.
- Say a state once in a row. Its mark and words belong together.
- A problem gives its cause and the action that can fix it. Do not offer an action the source refused.
- An action's label says what it opens or changes. A different decision needs a separate press.
- Condensed text never quotes credentials.
- Only new arrivals animate. Opening or restoring content places it.
- A view opens or changes place when the person asks; background work does not choose it.
- Resolve a view's destination before painting it.
- Name a Mate's own state in third person; address the person directly for other facts.
- Give a reset time only from source evidence. Promise automatic continuation only while enabled.
  A passed clock time does not prove work resumed.

## 2. Copy glossary

Use short declarative sentences and second person; "developer-first" is the self-description. No hype. These are user-facing words;
identifiers, comments and test titles keep their code names. `t3code/no-legacy-vocabulary` (R4) fails a retired word in
user-facing copy and quotes its replacement; `packages/shared/src/legacyVocabulary.ts` holds the enforced list.

One word for each thing:

- **HQ** — the shared headquarters app, with one tenant per organization. Organizations do not create an HQ project.
  Zerops's own account site is "Zerops".
- **project** — what the menu lists. Source words: environment (a server connection), application, an HQ application.
  A Zerops project beside an application is called by its name. A Zerops-level part of a project is never a project:
  it is Stage, Production or a Mate's workspace.
- **Mate** — a colleague, always by name; the organization-wide one is the Chief. "A Mate is a coding agent with a
  workspace of its own and one conversation you come back to." Never "the agent" for a Mate.
- **coding agent** — Claude, Codex and the others, only where a Mate is signed in. Source: provider, agent. Say
  "Sign {Mate} in with Claude or ChatGPT", or "Sign this Mate in"; never "Sign in an agent".
- **helpers** — a Mate's own sub-agents; on a crew they are crewmates.
- **workspace** — a Mate's own place to build (the engine's dev service, `appdev`); its private address is
  **{Mate}'s preview** (the stage half of a dev/stage pair, `appstage`). Engine service names never stand as copy.
- **Stage**, **Production** — the project's shared environments; "environment" is only their collective word.
- **sign in**, **signed in**, **sign out** — never log in, logged in or log out.
- **change** — never pull request or PR. Name a change by its title rather than its number. A merged change is
  **merged**, never landed. Its merge says **Adds this change to main**; squash and commit counts stay in the
  Commits fold.
- **PR #n** — only for the GitHub pull request a change is mirrored to, linked to it ("PR #2 on GitHub"); Mate's
  own object stays a **change**.
- **release** — "Putting {version} live", "{service} gets {version}". No commit hash names a release.
  In the Git browser a commit's 7-character id may stand beside its subject, as a link, never alone.
- **planning** — HQ deciding which deploys a merge or release asks for. Until HQ has, a surface says **Waiting for
  planning**, never that nothing will deploy. Source words: rollout, plan lock.
- **setup**, **setup files** — never recipe or import files.
- **Read access**, **Full access** — sentence case, each explained once where it is chosen.
- **Owner**, **Admin**, **Developer**, **Guest** — the roles, as the invite names them; the menu's foot says
  "{organization} · {role}" for every role. A Zerops role no preset names reads by what it reaches (**Works on every
  project**, **Sees every project**); a Zerops role code appears only where a Zerops role itself is chosen.
- **Put it on your domain** — the first own domain, everywhere it is offered; **Manage addresses** once
  there is one.
- **page** — what the side panel opens; never surface.
- **Zerops Control Plane** — never zcp.

Source words and the product words that replace them:

- pull request, PR → **change**
- rebase → **merge main into it**
- provider → **coding agent**
- pairing → **Sign in with Zerops**
- Connections → **Devices**
- worktree, Local checkout, lane → **its own copy of {Mate}'s code**
- T3 Connect, Tailscale, T3 Code → **omit**
- Open in editor → **Cloud IDE**
- zcp → **Zerops Control Plane**
- project-level variables, Shared → **every app**; an app's own: **{app}'s own**
- environment variables, Plain / Sensitive → **vault values**; sensitive: **hidden**
- control plane (product name) → **Zerops Mate**
- stage half of a dev/stage pair, appstage → **{Mate}'s preview**
- dev service, appdev → **{Mate}'s workspace**
- deploying a crewmate's work → **Deploy to {host}**
- group stage project → **Stage**
- a Mate's recipe proposal, recipe, import files → **setup files**
- agent on a crew → **crewmate**
- orchestrator → **lead**
- crew intent, brief → **goal**
- crewmate intent, role → **job**
- assignment → **task**
- conversation tab, thread → **chat**
- land a crewmate's work → **add to {Mate}'s code; in {Mate}'s code**
- landed (a change) → **merged**
- squash-merge → **Adds this change to main**
- your tree → **{Mate}'s code**
- deliver → **ship**
- crew run → **working on its own**
- budget → **what it may spend**
- Start fresh → **Clear its conversation**
- Discard → **Drop it; Drop the plan**
- Allow → **Let it; Not now**
- Back to my tree → **Back to {Mate}'s**
- parked → **Stopped**
- writer, reader, lead → **Builds, Reviews, Plans**
- backup set, backup store → **backup, backup bucket**
- git repositories → **repositories**
- environment deploy token, token-encryption key → **deploy tokens, key for its deploy tokens**
- connected presence → **online**
- degraded → **Needs attention**
- healthy → **Running**
- log in, logged in, log out → **sign in, signed in, sign out**
- Sign in an agent → **Sign {Mate} in**
- Basic user, Read only (an organization's role) → **Works on every project**, **Sees every project**; at least
  Basic user access (a project's) → **Edit**; Member → the role's own name
- surface → **page**
- Add your domain → **Put it on your domain**
- Set custom accesses → **Choose projects**; Advanced (a role's Zerops settings) → **Fine-tune permissions**
- container (a Mate's) → **its computer**; closed off → **private network ready**

## 3. Visual grammar

Use tint to show depth. Blue acts; teal identifies. Palette and contrast come from shared tokens.
A status mark carries its word or an accessible name. Use scalable vector icons rather than an icon
font. Clients share meaning and copy while using their native containers.
Nested rounded edges run parallel: the outer radius is the inner radius plus the space between them.

- One scale, from `packages/shared/src/brand.ts` and projected into the web theme: five type steps
  (`text-caption`, `text-body`, `text-emphasis`, `text-title`, `text-display`), spacing on a 4 px
  grid, three nested radii (`rounded-control` inside `rounded-card` inside `rounded-sheet`), three
  durations (`--duration-quick`, `--duration-base`, `--duration-slow`) with `ease-out-strong` for
  what arrives and `ease-in-out-strong` for a paired enter and leave.
- An action is a `Button`: `primary` for the one next step, `secondary` beside it, `ghost` for
  quiet tools, `destructive` only for what deletes or stops, `link` inside text. Buttons are
  rectangles; a word that acts inside a sentence is `InlineButton`.
- A label is a `Badge` pill in one of five tones (`neutral`, `info`, `success`, `warning`,
  `danger`), so it never reads as a press; a status dot is its `dot` form, with its words or an
  accessible name.

## 4. Rules — machine-checked

- **R1** — `client-runtime/src/zerops/**` is UI-free and platform-free
  - _Enforced by:_ zone rule 5 (import prefixes) + `t3code/no-platform-globals` (resolved globals) +
    constructor tests
  - _Test(s):_ `scripts/mate-zone-architecture.test.ts` "client-runtime zerops is UI-free and
    platform-free"; `oxlint-plugin-t3code/rules/no-platform-globals.test.ts`; module tests "accepts
    storage / fetch / clock explicitly"
  - _Status:_ landed (W2-F3-MOVE `9e3e25d8b`)
- **R2** — Protected roots render only
  - _Enforced by:_ zone rule 6 (module-graph walk over the protected roots + explicit `WS_METHODS`
    read/allowed-command sets)
  - _Test(s):_ `scripts/mate-zone-architecture.test.ts` "protected roots render only"
  - _Status:_ landed (W1: `282c82585`, reapplied `beb3f683d`)
- **R3** — Tokens only
  - _Enforced by:_ `t3code/no-theme-escape-hatches` (semantic sinks) + `scripts/check-css-tokens.ts`
    (parser over declarations)
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-theme-escape-hatches.test.ts`;
    `scripts/check-css-tokens.test.ts`
  - _Status:_ landed (W1-R3 `fe9e0a6af`; quote-aware bracket scan follows in W1-R3-FIX)
- **R4** — No legacy vocabulary in user-facing copy
  - _Enforced by:_ `t3code/no-legacy-vocabulary` (closed sink list, word boundaries)
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-legacy-vocabulary.test.ts`
  - _Status:_ landed (W1-R4 `3521900ec`); each finding quotes the glossary's replacement
- **R5** — One status resolver, one phrase producer
  - _Enforced by:_ `packages/shared/src/threadStatus.ts` + the vector test + zone rule 7 (bans the
    known local status-table shapes in the named consumers)
  - _Test(s):_ `packages/shared/src/threadStatus.test.ts` (vector: web row · palette pill · mobile
    row · widget props · relay); `scripts/mate-zone-architecture.test.ts` "one status resolver"
  - _Status:_ landed (W2-F3-STATUS `3149346fb`)
- **R6** — No continuous repaint
  - _Enforced by:_ `scripts/check-css-motion.ts` (`animation`/`animation-iteration-count` with
    `infinite` ⇒ stepped helper or exception) + `t3code/no-infinite-motion` (`withRepeat(-1)`
    resolved to its import; `Spinner` by binding in the protected roots)
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-infinite-motion.test.ts`;
    `scripts/check-css-motion.test.ts`
  - _Status:_ landed (W1-R6 `bae1c10e8`, walker `c3be8d707`)
- **R7** — The theme is complete and legible
  - _Enforced by:_ a `packages/shared` test over `ZEROPS_THEME` × `THEME_COLOR_ROLES`
  - _Test(s):_ `packages/shared/src/zeropsTheme.test.ts` (exact key equality both appearances; alpha
    1; the named contrast pairs; projections equal their source)
  - _Status:_ landed (W2-F4-THEME `0b5ed6530`)
- **R8** — Generated copies are current
  - _Enforced by:_ `scripts/generate-theme-tokens.ts --check` in CI `check`
  - _Test(s):_ `scripts/generate-theme-tokens.test.ts` (byte equality of every projection)
  - _Status:_ landed (W2-F4-PROJ `9c9f6f04d`, preload fix `376903888`)
- **R9** — UI kit exports are used, not restyled
  - _Enforced by:_ `t3code/no-restyle` — `@shadcn/lint`'s no-restyle run as a fork guard through
    `oxlint-plugin-t3code/shadcnGuard.ts` (a `CollapsibleTrigger` is exempt); CI reconciles `--rule
no-restyle`
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-restyle.test.ts`
  - _Status:_ landed (intake row 5, 2026-09-25)
- **R10** — Class names are known and static
  - _Enforced by:_ `t3code/no-unknown-classes` + `t3code/require-static-classes` — `@shadcn/lint`
    against `apps/web/src/index.css` and its imports; CI reconciles both rules
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-unknown-classes.test.ts`;
    `oxlint-plugin-t3code/rules/require-static-classes.test.ts`
  - _Status:_ landed (intake row 5, 2026-09-25)
- **R11** — Scale values, not arbitrary ones
  - _Enforced by:_ `t3code/no-arbitrary-values` (Tailwind arbitrary values where the theme has a
    token: `text-2xs`/`text-3xs`, `ease-drawer`, the gutters); CI reconciles `--rule
no-arbitrary-values`
  - _Test(s):_ `oxlint-plugin-t3code/rules/no-arbitrary-values.test.ts`
  - _Status:_ landed (intake row 5, 2026-09-25); hand-written CSS sizes, corners and transition
    lengths between the scale's steps are held to a budget that only shrinks
    (`scripts/check-css-tokens.ts`)

## 5. Exceptions

A guard exception names one finding, its owner, reason and expiry. Review a changed finding again;
remove a dead or expired exception. A permanent exception needs a reason why the finding is correct.
The machine ledgers own the entries and fingerprints; do not copy their counts into documentation.
