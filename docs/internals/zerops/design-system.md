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

## 2. Copy glossary

Use short declarative sentences and second person; "developer-first" is the self-description. No hype. These are user-facing words;
identifiers and comments keep their code names.

| Source word                                    | Product word                                 |
| ---------------------------------------------- | -------------------------------------------- |
| environment                                    | **project**                                  |
| application                                    | **project**                                  |
| a Zerops project beside an application         | **its name**                                 |
| pull request, PR                               | **change**                                   |
| rebase                                         | **merge main into it**                       |
| provider                                       | **coding agent**                             |
| pairing                                        | **Sign in with Zerops**                      |
| Connections                                    | **Devices**                                  |
| worktree, Local checkout, lane                 | **its own copy of {Mate}'s code**            |
| T3 Connect, Tailscale, T3 Code                 | **omit**                                     |
| Open in editor                                 | **Cloud IDE**                                |
| zcp                                            | **Zerops Control Plane**                     |
| project-level variables, Shared                | **values**; an app's own: **own values**     |
| environment variables, Plain / Sensitive       | **vault values**; sensitive: **secret**      |
| control plane (product name)                   | **Zerops Mate**                              |
| stage half of a dev/stage pair                 | **preview**                                  |
| deploying a crewmate's work                    | **Deploy to {host}**                         |
| group stage project                            | **stage**                                    |
| agent on a crew                                | **crewmate**                                 |
| orchestrator                                   | **lead**                                     |
| crew intent, brief                             | **goal**                                     |
| crewmate intent, role                          | **job**                                      |
| assignment                                     | **task**                                     |
| conversation tab                               | **chat**                                     |
| land a crewmate's work                         | **add to {Mate}'s code; in {Mate}'s code**   |
| your tree                                      | **{Mate}'s code**                            |
| deliver                                        | **ship**                                     |
| crew run                                       | **working on its own**                       |
| budget                                         | **what it may spend**                        |
| Start fresh                                    | **Clear its conversation**                   |
| Discard                                        | **Drop it; Drop the plan**                   |
| Allow                                          | **Let it; Not now**                          |
| Back to my tree                                | **Back to {Mate}'s**                         |
| parked                                         | **Stopped**                                  |
| writer, reader, lead                           | **Builds, Reviews, Plans**                   |
| backup set, backup store                       | **backup, backup bucket**                    |
| git repositories                               | **repositories**                             |
| environment deploy token, token-encryption key | **deploy tokens, key for its deploy tokens** |
| connected presence                             | **online**                                   |
| degraded                                       | **Needs attention**                          |
| healthy                                        | **Running**                                  |

## 3. Visual grammar

Use tint to show depth. Blue acts; teal identifies. Palette and contrast come from shared tokens.
A status mark carries its word or an accessible name. Use scalable vector icons rather than an icon
font. Clients share meaning and copy while using their native containers.
Nested rounded edges run parallel: the outer radius is the inner radius plus the space between them.

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

A guard exception names one finding, its owner, reason and expiry. Review a changed finding again;
remove a dead or expired exception. A permanent exception needs a reason why the finding is correct.
The machine ledgers own the entries and fingerprints; do not copy their counts into documentation.
