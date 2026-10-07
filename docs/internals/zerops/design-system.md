# Design system — the working spec

Dated ledger file, one writer (the orchestrator of the UI foundations programme). It holds what
a client slice needs and no spec section states yet: the component vocabulary (anatomy · states
· phrase source), the copy glossary, the icon map, the machine-checked rules with their tests,
and the exception ledgers. A decision promotes to `../../../../zcp/docs/spec-mate.md` ("client
design system" section) when the programme lands; a measured fact goes to `verified.md`. This
file is the step between; the dated decisions it took live in `design-decisions.md`.

Started 2026-08-30 (F0). Nothing visual is decided here — a surface's anatomy lands in its entry
when the owner fixes its flow, through the surface-round loop. A field an entry leaves out is open.

## 1. Vocabulary

### Shared principles

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

### Vocabulary

Fixed by the accepted principles (concept P1–P8): depth by tint, one `MicroLabel`, `StatusDot` +
word (never a bare dot), pills and chips, blue acts / teal identifies, native containers on
mobile. Everything else in a row is filled by the slice that builds it.

## 2. Glossary — the words the UI uses

T3 word → Zerops word. User-facing copy only (R4 guards the sinks); identifiers, imports and
comments keep whatever name the code has. Crew mode's rows put the word its design used on the
left.

| T3 says                                                                                 | mate says                                                                                       |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| environment                                                                             | **project**                                                                                     |
| HQ's application, the layer above Zerops projects (the code's _group_, _app_)           | **project** — "Move to project…", "New project", "No project"; never _group_, _application_     |
| a Zerops project shown beside one (a Mate's, a stage's)                                 | **its name**; never _project_ in the same dialog                                                |
| pull request, PR                                                                        | **change** — "Change #4 waits for your merge", "2 open changes"; HQ's word for a Mate's work    |
| rebase (a change behind or in conflict with `main`)                                     | **merge `main` into it** — "Conflicts with main"; HQ takes a Mate's push only forward           |
| provider                                                                                | **coding agent**                                                                                |
| pairing, pairing code                                                                   | **Sign in with Zerops**; no pairing code or one-time link is offered                            |
| Connections                                                                             | **Devices**                                                                                     |
| worktree, Local checkout; a crewmate's worktree or lane                                 | gone — a crewmate's copy is "its own copy of Fen's code", in setup and under _Try its work_     |
| T3 Connect, Tailscale, T3 Code                                                          | gone                                                                                            |
| Open in editor                                                                          | **Cloud IDE**                                                                                   |
| the `zcp` service                                                                       | **Zerops Control Plane**, under Infrastructure                                                  |
| project env, project-level variables                                                    | **Shared** — the project's vault; never _project variables_                                     |
| env vars, environment variables, secrets                                                | **the vault**, its **values** — each _Plain_ or _Sensitive_                                     |
| commit & push                                                                           | zcp's pipeline, never the client's                                                              |
| "control plane" (self-description)                                                      | never — the product is Zerops Mate                                                              |
| stage half of a Mate's pair                                                             | **preview** — `appstage` beside `appdev`, runs a change before it is merged                     |
| a crewmate's commit deployed to another service by `sha=` (the crew design's _preview_) | **Deploy to `<host>`** — never _preview_, which is only the stage half                          |
| a group stage project                                                                   | **stage** — only that: optional, a side branch of `main`, never a gate                          |
| agent (one of a crew)                                                                   | **crewmate** — mostly just its name and face; _agent_ stays the coding agent                    |
| orchestrator                                                                            | **lead**                                                                                        |
| intent (for the whole crew); the crew design's brief                                    | **goal** — _Change the goal_; its title heads the Crew tab                                      |
| intent (for one crewmate), role                                                         | **job** — _role_ is the Zerops membership role                                                  |
| assignment                                                                              | **task**                                                                                        |
| tab (another conversation with the Mate)                                                | **chat** — "+ New chat"                                                                         |
| merge (a crewmate's work into the Mate's tree); land, landed                            | **add to Fen's code** — the review's button; once in, **in Fen's code**; not a change's _Merge_ |
| your tree (the Mate's working copy)                                                     | **Fen's code** — the Mate's name, never "your tree"                                             |
| deliver; landed, not delivered                                                          | **ship** — "Fen hasn't shipped these yet · Ask Fen to ship them"                                |
| run (the crew working within limits); pause, resume                                     | **working on its own** — _Let it work on its own…_, one _Stop_, _Keep going…_; no pause         |
| budget                                                                                  | **what it may spend** — "up to $20"                                                             |
| Start fresh                                                                             | **Clear its conversation** — "It keeps its job and its work."                                   |
| Discard                                                                                 | **Drop it**; a plan's **Drop the plan**                                                         |
| Allow (a crewmate showing its work at the Mate's dev address)                           | **Let it**, beside _Not now_                                                                    |
| Back to my tree                                                                         | **Back to Fen's**                                                                               |
| parked                                                                                  | **Stopped**                                                                                     |
| writer, reader, lead (what a crewmate does)                                             | **Builds**, **Reviews**, **Plans**                                                              |
| HQ's backup set (`apps/hq` _set_), its store                                            | **backup**, **backup bucket** — "Last backup today 14:00"; pending the owner's review           |
| HQ's git repositories (_quarantined_ ones)                                              | **repositories** — "Repository Links/api is closed"; pending the owner's review                 |
| an environment's deploy token, HQ's `HQ_KEY_SECRET`                                     | **deploy tokens**, **key for its deploy tokens**; pending the owner's review                    |
| a Mate's link to HQ open (`presence.online`)                                            | **online** — "3 online" on HQ's card; pending the owner's review                                |
| HQ serving with something wrong (degraded)                                              | **Needs attention** — an owner's or an admin's headline only; pending the owner's review        |
| HQ serving, to a member who sees none of its parts                                      | **Running** — never _Healthy_, which claims more; pending the owner's review                    |

Tone: short declarative sentences, second person, "developer-first" as the one self-descriptor,
no hype. Colour grammar: **blue acts, teal identifies** — `messageAction` (`#0077cc`) for
everything that does something; teal only as the mark, the identity pill tint, the `update`
role and the connected/authorized dots.

## 3. Icon map

Placeholder until F4-FONTS/F5b fill it. Rules already fixed: lucide on web, Tabler on mobile; no
Material Icons webfont; the mark as path data (`brand.ts`) rendered by `<svg>` /
`react-native-svg`; provider marks as `currentColor` SVGs; the 87 service-type icons are **not**
used in map rows (concept D7).

| Glyph id | Meaning | lucide (web) | Tabler (mobile) |
| -------- | ------- | ------------ | --------------- |

## 4. Rules — machine-checked

Predicates are the plan's (`../../../../zcp/plans/z3-ui-foundations-2026-08-30.md` §3, frozen at
F0); this table records where each rule is enforced and by which test, and when it landed. A
rule is "landed" only when its test runs in CI.

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
  - _Status:_ landed (W1-R4 `3521900ec`; ledger 102 after W1-D-NAMING)
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
  - _Status:_ landed (intake row 5, 2026-09-25)

Protected roots (R2, R6): today `apps/web/src/components/zerops/{ZeropsServiceMap,ZeropsLifecycleStrip,ZeropsOperationCard,ZeropsQuickActions}.tsx`;
after a surface round moves them, `apps/web/src/components/zerops/{map,band,cards,quickActions}/**`
and the mobile counterparts `apps/mobile/src/features/zerops/{map,band,cards,quickActions}/**`.
The door, picker, session provider and agent-auth card issue commands legitimately and are not
protected; their commands are the explicit allowed set.

## 5. Exceptions

**Policy (DN10).** Every guard's exceptions are fingerprint entries, never files, never counts.
CI fails on a **new** finding without an entry, a **dead** entry (its fingerprint matches nothing
any more), a **changed** entry (the same path and kind still has a finding, but a different
fingerprint — the code under the entry moved and needs re-review) and an **expired** entry (its
`expires` phase is complete). The ledger only shrinks, except for entries with `expires: "never"`
(technical literals that are correct by design — ANSI-16, Pierre, shiki — each with a reason).

**Entry schema** (one JSON array per rule, in `oxlint-plugin-t3code/exceptions/<rule>.json`;
completed phase ids in `oxlint-plugin-t3code/exceptions/phases.json`):

```json
{
  "path": "<repo-relative path>",
  "kind": "<AST node type | css-declaration>",
  "fingerprint": "<normalized source of the node / declaration>",
  "owner": "<name>",
  "reason": "<why this is correct>",
  "expires": "<phase id | surface:<manifest id> | never>"
}
```

Normalization: whitespace collapsed to one space, trimmed; for a CSS declaration
`<selector>{<property>:<value>}` with the same collapsing. The loader, the reconcile function and
their tests are shared (`oxlint-plugin-t3code/exceptions.ts`, W1-EXC).

**Ledger sizes** (updated at every wave end and every intake; the machine files are the truth — counted 2026-09-29, after pass 16):

| Rule | File                                      |                Entries | `never` | Notes                                                                                                                                  |
| ---- | ----------------------------------------- | ---------------------: | ------: | -------------------------------------------------------------------------------------------------------------------------------------- |
| R3   | `exceptions/no-theme-escape-hatches.json` | 385 (358 ast + 27 css) |     230 | baseline = the violations outside the Zerops dirs; the vendor provider colours (Claude, Cursor, OpenCode, Antigravity) are `never`     |
| R4   | `exceptions/no-legacy-vocabulary.json`    |                     55 |      50 | upstream surfaces' exact literals (the branch toolbar, settings panels, thread actions, mobile git sheets); 5 expire at F6             |
| R6   | `exceptions/no-infinite-motion.json`      |    27 (18 ast + 9 css) |      27 | the known continuous uses; since 2026-09-29 a working Mate's face (its turn and glance), the composing dots and a running call's sweep |
| R9   | `exceptions/no-restyle.json`              |                    306 |       0 | restyles that predate the ui-kit pass (65 in the Zerops dirs); all expire at F6                                                        |
| R10  | `exceptions/no-unknown-classes.json`      |                      3 |       3 | the `MateMark.css` classes — `@shadcn/lint` reads only `index.css` and its imports                                                     |
| R10  | `exceptions/require-static-classes.json`  |                      4 |       0 | runtime-built `className`s on ui exports (1 in the Zerops dirs); expire at F6                                                          |
| R11  | `exceptions/no-arbitrary-values.json`     |                    206 |       0 | arbitrary values that predate the token pass (118 in the Zerops dirs; 2 are the usage breakdown's 8px avatar initials); expire at F6   |

## 6. Decisions taken inside the programme

The dated log lives in [`design-decisions.md`](design-decisions.md) — grep it by date or by a
surface's name; never read it whole.
