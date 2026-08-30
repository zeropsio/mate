# Design system — the working spec

Dated ledger file, one writer (the orchestrator of the UI foundations programme). It holds what
a client slice needs and no spec section states yet: the component vocabulary (anatomy · states
· phrase source), the copy glossary, the icon map, the machine-checked rules with their tests,
and the exception ledgers. A decision promotes to `../../../../zcp/docs/spec-z3.md` ("client
design system" section) when the programme lands; a measured fact goes to `verified.md`. This
file is the table between.

Started 2026-08-30 (F0). Nothing visual is decided here — a surface's anatomy lands in its row
when the owner fixes its flow, through the surface-round loop. Columns marked `—` are open.

## 1. Vocabulary

Fixed by the accepted principles (concept P1–P8): depth by tint, one `MicroLabel`, `StatusDot` +
word (never a bare dot), pills and chips, blue acts / teal identifies, native containers on
mobile. Everything else in a row is filled by the slice that builds it.

| Component        | Clients      | Anatomy (fixed part)                                                                                                                                       | States                                                                                              | Phrase source                                                                      | Lands         |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------- |
| `StatusDot`      | web · mobile | one glyph in a status tone; never rendered without a `MicroLabel` word beside it; in-flight = the stepped `status-pulse`, never an `infinite` opacity loop | ok · busy (pulse) · attention · failed · off                                                        | tone id from `brand.ts` status tones; the word from the consumer's phrase function | F5b           |
| `MicroLabel`     | web · mobile | 10 px / 600 / uppercase / .06em / 45 % (11 px on mobile)                                                                                                   | —                                                                                                   | —                                                                                  | F5b           |
| `Chip`           | web · mobile | 10 px text, tint from `brand.ts` chip tints, radius 10 (info-chip 8)                                                                                       | —                                                                                                   | —                                                                                  | F5b           |
| `Pill`           | web · mobile | the CTA shape for primary/secondary buttons; ghost and icon buttons keep 8 px                                                                              | —                                                                                                   | —                                                                                  | F5b           |
| `FlatCard`       | web · mobile | flat and borderless in light, 1 px `rgba(255,255,255,.06)` in dark; shadows only on popovers/dialogs                                                       | —                                                                                                   | —                                                                                  | F5b           |
| `MintPanel`      | web · mobile | the zcp row under Infrastructure: dot + word, the 2-column pill grid, the agent tray                                                                       | —                                                                                                   | —                                                                                  | F5b           |
| `ProcessSteps`   | web · mobile | `30px 1fr` grid, 17 px step glyphs in 2 px-bordered circles                                                                                                | queued · running · done · failed                                                                    | —                                                                                  | F5b           |
| `KeyChip`        | web          | key glyph, radius 3                                                                                                                                        | —                                                                                                   | —                                                                                  | F5b           |
| `LivenessLine`   | web · mobile | one line under a feed header                                                                                                                               | live · polling · doorbell down · last read failed · absent (renders nothing)                        | topology availability (`serviceMap`), see spec-z3 §5.1 tri-state                   | F5b           |
| `LifecycleBand`  | web · mobile | 28 px, 12/500, tone tint, `StatusDot` + phrase                                                                                                             | precedence: waiting for you › tool running › phase                                                  | `client-runtime/zerops/strip.ts`                                                   | surface round |
| `ServiceRow`     | web · mobile | —                                                                                                                                                          | settled statuses + `transient`                                                                      | `brand.ts` status table (platform status → tone)                                   | surface round |
| `ZeropsCard`     | web · mobile | process shell: tone-tinted header stripe with a `MicroLabel` kicker, `ProcessSteps` body                                                                   | kinds plan · import · mount · deploy · verify · subdomain · error; undecodable ⇒ generic tool block | total decoders in `client-runtime/zerops/cards`                                    | surface round |
| `QuestionCard`   | web · mobile | —                                                                                                                                                          | —                                                                                                   | —                                                                                  | surface round |
| `CredentialCard` | web · mobile | —                                                                                                                                                          | —                                                                                                   | —                                                                                  | surface round |

## 2. Glossary — the words the UI uses

T3 word → Zerops word. User-facing copy only (R4 guards the sinks); identifiers, imports and
comments keep whatever name the code has.

| T3 says                            | z3 says                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| environment                        | **project**                                                                          |
| provider                           | **coding agent**                                                                     |
| pairing, pairing code              | **Sign in with Zerops**; the fallback: "Connect another device with a one-time link" |
| Connections                        | **Devices**                                                                          |
| worktree, Local checkout           | gone — no replacement word                                                           |
| T3 Connect, Tailscale, T3 Code     | gone                                                                                 |
| Open in editor                     | **Cloud IDE**                                                                        |
| the `zcp` service                  | **Zerops Control Plane**, under Infrastructure                                       |
| commit & push                      | zcp's pipeline, never the client's                                                   |
| "control plane" (self-description) | never — the product is Zerops Code                                                   |

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
| —        | —       | —            | —               |

## 4. Rules — machine-checked

Predicates are the plan's (`../../../../zcp/plans/z3-ui-foundations-2026-08-30.md` §3, frozen at
F0); this table records where each rule is enforced and by which test, and when it landed. A
rule is "landed" only when its test runs in CI.

| #   | Rule                                                        | Enforced by                                                                                                                                                                                                                                | Test(s)                                                                                                                                                                                                          | Status       |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| R1  | `client-runtime/src/zerops/**` is UI-free and platform-free | zone rule 5 (import prefixes) + `t3code/no-platform-globals` (resolved globals) + constructor tests                                                                                                                                        | `scripts/z3-zone-architecture.test.ts` "client-runtime zerops is UI-free and platform-free"; `oxlint-plugin-t3code/rules/no-platform-globals.test.ts`; module tests "accepts storage / fetch / clock explicitly" | planned (W2) |
| R2  | Protected roots render only                                 | zone rule 6 (module-graph walk over the protected roots + explicit `WS_METHODS` read/allowed-command sets)                                                                                                                                 | `scripts/z3-zone-architecture.test.ts` "protected roots render only"                                                                                                                                             | planned (W1) |
| R3  | Tokens only                                                 | `t3code/no-theme-escape-hatches` (semantic sinks) + `scripts/check-css-tokens.ts` (parser over declarations)                                                                                                                               | `oxlint-plugin-t3code/rules/no-theme-escape-hatches.test.ts`; `scripts/check-css-tokens.test.ts`                                                                                                                 | planned (W1) |
| R4  | No legacy vocabulary in user-facing copy                    | `t3code/no-legacy-vocabulary` (closed sink list, word boundaries)                                                                                                                                                                          | `oxlint-plugin-t3code/rules/no-legacy-vocabulary.test.ts`                                                                                                                                                        | planned (W1) |
| R5  | One status resolver, one phrase producer                    | `packages/shared/src/threadStatus.ts` + the vector test + zone rule 7 (bans the known local status-table shapes in the named consumers)                                                                                                    | `packages/shared/src/threadStatus.test.ts` (vector: web row · palette pill · mobile row · widget props · relay); `scripts/z3-zone-architecture.test.ts` "one status resolver"                                    | planned (W2) |
| R6  | No continuous repaint                                       | `scripts/check-css-motion.ts` (`animation`/`animation-iteration-count` with `infinite` ⇒ stepped helper or exception) + `t3code/no-infinite-motion` (`withRepeat(-1)` resolved to its import; `Spinner` by binding in the protected roots) | `oxlint-plugin-t3code/rules/no-infinite-motion.test.ts`; `scripts/check-css-motion.test.ts`                                                                                                                      | planned (W1) |
| R7  | The theme is complete and legible                           | a `packages/shared` test over `ZEROPS_THEME` × `THEME_COLOR_ROLES`                                                                                                                                                                         | `packages/shared/src/zeropsTheme.test.ts` (exact key equality both appearances; alpha 1; the named contrast pairs; projections equal their source)                                                               | planned (W2) |
| R8  | Generated copies are current                                | `scripts/generate-theme-tokens.ts --check` in CI `check`                                                                                                                                                                                   | `scripts/generate-theme-tokens.test.ts` (byte equality of every projection)                                                                                                                                      | planned (W2) |

Protected roots (R2, R6): today `apps/web/src/components/zerops/{ZeropsServiceMap,ZeropsLifecycleStrip,ZeropsToolCard,ZeropsQuickActions}.tsx`;
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

**Ledger sizes** (updated at every wave end; the machine files are the truth):

| Rule | File                                      | Entries | `never` | Notes                                                                                                                                                     |
| ---- | ----------------------------------------- | ------: | ------: | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3   | `exceptions/no-theme-escape-hatches.json` |       — |       — | baseline = today's violations outside the Zerops dirs (the plan counts 225 web utilities + 155 mobile literals — the exact number is what the scan finds) |
| R4   | `exceptions/no-legacy-vocabulary.json`    |       — |       — | the manual one-time-link fallback component's exact literals                                                                                              |
| R6   | `exceptions/no-infinite-motion.json`      |       — |       — | the four known continuous uses today                                                                                                                      |

## 6. Decisions taken inside the programme

Decisions the plan did not foresee, taken by the orchestrator from the plan's rules and noted
here (the owner decides only what the orchestrator brief §6 lists).

| Date       | Decision                                                                                                                                                                                                            | Why                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 2026-08-30 | Exception ledgers live in `oxlint-plugin-t3code/exceptions/*.json`, one file per rule, plus `phases.json`; the CSS check scripts read the same files.                                                               | one loader, one reconcile, one place a reviewer looks; the plugin package already owns the rules        |
| 2026-08-30 | The clean-checkout diagnostic for untracked package shells (`packages/ssh`, `packages/tailscale`) is one CI step in the `check` job, delivered inside the R3 slice (its own commit) rather than a slice of its own. | trivial, and R3 already edits `ci.yml`; a separate slice would only add a serial merge on the same file |
