# mate — Zerops Mate

Zerops Mate is a hard fork of T3 Code: a control surface for coding agents. Its server runs inside a
Zerops `zcp` container under `/mate/`, spawning Claude Code / Codex with ZCP's MCP tools attached;
its client — web, desktop, mobile — is the product surface a Zerops user signs into.

## Size the work first

Name the tier before the first tool call. A tier's loop is the whole loop; a higher tier's rituals
are waste on a lower one (measured 2026-09-30: two chips and three spacing nudges, run as a pass,
took 53 min, 218 calls, 83 M tokens and 9 commits — +44 lines of CSS, +1,136 lines of tests).

- **Tweak** — the look of what exists: CSS, spacing, colour, copy, an icon, one component's layout.
  Grep the lines, edit, take one look cropped to the surface at the owner's view (1786 × 1000, the
  menu at 435 px) in the theme the report names, `vp check` the files, one commit. No new test,
  harness, sampler, theme × shell matrix, ledger entry, subagent or release unless asked. A test
  that pinned the old class, pixel or colour is deleted, not updated.
- **Change** — behaviour: state, data, protocol, a new control. RED → GREEN on the logic
  (`*.logic.ts`, server, runtime), targeted `vp test run`, package typecheck, one live look for UI.
- **Pass** — the owner calls it a pass, or it redesigns several surfaces or lands a slice: the loop
  in `docs/internals/zerops/fork.md` §5.

## What a doc may hold

A line in `docs/` must hold for something that does not exist yet: a rule across surfaces, a term,
the zcp↔mate seam, a platform fact our code relies on. Anything about one surface, flow or component
is a test (behaviour: its title is the product sentence, plus a one-line why when the owner decided
against the obvious) or the code itself (look). Reasons and reversals go in the commit message.

A rewrite keeps every test sentence: it changes how a test arranges its input, never what its title
says. Deleting a sentence removes the behaviour and needs the owner's word in the commit.
A behaviour a person sees is tested against the surface's input (the record it reads → what it
shows), so swapping the data source turns it red.

## Where knowledge lives

This file is a MAP, not a knowledge store — it never caches a product fact that already lives in
code, tests or another document. To answer a question, go to the home:

| Knowledge                                                                                                                | Home                                                                       |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| The zcp↔mate seam                                                                                                        | `../zcp/docs/spec-mate.md` §2.8                                            |
| Domain terms — Mate, HQ, application, environments, release and crew                                                     | `docs/internals/zerops/primer.md`                                          |
| Fork rules — zones, freeze, keep/delete, work loop, intake                                                               | `docs/internals/zerops/fork.md`                                            |
| Provider runtime SPI contract — version, delivery guarantee, enrichment, typed capabilities, fixtures, porting checklist | `docs/internals/zerops/spi.md`                                             |
| Per-port compatibility matrix                                                                                            | `docs/internals/zerops/compat.md`                                          |
| Platform assumptions our code relies on                                                                                  | `docs/internals/zerops/verified.md` or a comment beside the dependent code |
| Shared UI principles, copy glossary, tokens, guard rules and exception policy                                            | `docs/internals/zerops/design-system.md`                                   |
| Behavior invariant                                                                                                       | a test whose title is the product sentence                                 |
| Transient roadmap / journal                                                                                              | `../zcp/plans/` (never cite as a source)                                   |
| Upstream agent guide (still accurate below the banner)                                                                   | `AGENTS.md`                                                                |

## Zones

| Zone                                                                                                                                                                                                                                                                                                                                                                                                  | Rule                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Import** — wire-protocol packages (`packages/effect-codex-app-server`, `packages/effect-acp`)                                                                                                                                                                                                                                                                                                       | byte-identical, re-imported from an upstream SHA in one commit, pinned by `imported.lock`  |
| **Port** — provider drivers (`apps/server/src/provider/**`, provider contracts)                                                                                                                                                                                                                                                                                                                       | ported behind the adapter SPI, our edits stay minimal so ports stay cheap                  |
| **Owned** — the rest of `apps/server`, shared packages, desktop, mobile                                                                                                                                                                                                                                                                                                                               | ours; upstream changes are optional cherry-picks                                           |
| **Owned product** — `apps/server/src/zerops/**`, `apps/server/src/engine/**`, `packages/contracts/src/engine*.ts`, `apps/web/src/zerops/**`, `apps/web/src/components/zerops/**`, `packages/client-runtime/src/zerops/**`, `apps/mobile/src/features/zerops/**`, `packages/shared/src/{brand,threadStatus,crewHome,crewTemplates}.ts`, `apps/hq/**`, `packages/hq-git/**`, `docs/internals/zerops/**` | ours only; the client design system rules live in `docs/internals/zerops/design-system.md` |

Full map, `imported.lock` enforcement, and the adapter SPI contract: `docs/internals/zerops/fork.md` §3.

## Commands

- Prepare a lane: `cd "$(node scripts/prepare-worktree.ts <job>)"` (reuse an idle worktree; install and check readiness).

- Lanes run `node scripts/gate-changed.ts` (default diff: merge-base with `origin/main`, plus
  staged/working/untracked files). It checks guard ledgers, `vp check` on touched files, incremental
  typechecks of touched packages, related tests and only affected scenario areas. `--list` previews
  selection; `--base <ref>` changes the comparison. Use targeted tests while iterating.
- A lane's loop: targeted `vp test run <files>` while iterating; the gate once when the change is
  complete, then only the failed files and the gate once more. Rebase once, right before the push;
  re-run only what the rebase changed in the lane's files. A push rejected because `main` moved is
  rebased and pushed again without re-running. `ci-local` only after touching guard ledgers,
  exceptions, `surfaces.json`, theme tokens or tooling. At most one
  `gh run watch <id> --exit-status`, then read the failures once; never poll logs in a loop.
- The integrator runs the full gates before pushing the assembled work: `node scripts/ci-local.ts`
  for CI's Check job, plus the full unit and scenario suites. CI runs the repository-wide checks;
  lanes keep their local checks targeted.
- The CI Check job runs `vp check` repo-wide, ledger markdown included: a table row committed past
  the pre-commit hook (`--no-verify`, an editor) leaves unaligned columns and a red job — `vp fmt`
  the file first.
- A release is `node scripts/release-mate.ts` (`--minor` when the client's floor rises, `--dry-run`
  prints the plan): it bumps the three versions in a throwaway worktree of `origin/main`, pushes,
  tags, and waits until `stable.json` serves the new version.
- Delivery to a running container is the push loop, not a release:
  `../zcp/eval/scripts/mate-dev-push.sh`. A container restart wipes a dev build; push again after.

## When something that is not your code fails

Accounts, APIs, credentials, infrastructure, tools. Classify by the evidence, then act; before each
attempt write one line, "hypothesis: … / test: …". An identical action is never repeated expecting
a different result, except in class B.

- **A — yours**: a server, database, browser, worktree, dependency or runtime you started or own,
  or a wrong path, ID or variable in your own command. Fix it and continue; each attempt changes
  something.
- **B — transient**: timeout, 5xx, 429, "at capacity", connection reset, DNS SERVFAIL. The same
  action up to three times in all, with growing pauses (~10 s, 30 s, 90 s); still failing → D.
- **C — refused**: 401/403, 404, 409, 422, "not found", "permission denied", a missing credential or
  variable. One diagnosis: read the whole error body, name the account, credential and target in
  use (the key name or path, never a secret's value), confirm with one read-only call. Your own
  mistake → A; otherwise → D.
- **Unknown**: at most three distinct hypotheses, each tested once by the cheapest read-only probe;
  then A, B, C or D.
- **D — park**: stop only the steps that depend on it, finish every independent step, and end with
  `BLOCKED: <step> — <exact error> — <class> — tried: <hypotheses> — need: <one concrete question>`.

Never a workaround, always D: another identity or authority (account, credential, organization,
token, permission), a target the task does not name, `--no-verify` / `--force`, a disabled check,
substitute infrastructure.

## Context is the cost

Every tool call re-sends the whole conversation, so a task keeps its context small.

- A subagent or a worktree is for a pass's independent part or a long read-only search, never for a
  tweak or a one-surface change.
- A subagent's model and effort fit its job, not the lead's (`.claude/agents/`): `scout` (Sonnet,
  medium, read-only) for a search or a lookup, `part` (high) for a pass's part, `reviewer` (xhigh,
  read-only) for an independent review. Max effort stays with the lead.
- Hot files run 2–9k lines (`ChatView.tsx`, `index.css`, `SidebarZeropsTree.tsx`,
  `MessagesTimeline*`, `RunChat.tsx`): grep the symbol, read the range.
- Grep large reference files for the question before reading the relevant range.
- Command output shows failures only (`… 2>&1 | tail -40`); a screenshot is cropped to the surface,
  one per question.
- A paragraph-sized doc entry is a list item, never a table row: the formatter pads every row to its
  table's widest cell (`verified.md` was 48 % spaces), and one wider cell rewrites every row.

## Disciplines

- Tests pin behaviour — state, data, protocol, guards, what a render shows and what a click does —
  never a class string, a pixel or a colour: the owner judges the look by eye.
- TDD for behaviour: RED → GREEN, table-driven tests.
- Atomic commits, English, never a `Co-Authored-By` trailer.
- Delete, don't disable — no commented-out code or compat shims.
- Ported-zone edits stay minimal; a diverged port is an expensive port next time.
- The ledger has one writer — subagents report facts as text, never edit `verified.md` /
  `questions.md` / `hacks.md` / `map.md` / `poc-findings.md` directly.

## Maintenance

CLAUDE.md earns a line only for a cross-cutting trap or a discipline that isn't test-/spec-shaped.
Follow “What a doc may hold” when choosing a home. A fork rule belongs in `fork.md`; a platform
fact our code relies on belongs beside that code or in a short ledger entry with its verification
command. When a home already states it, delete the line here.
