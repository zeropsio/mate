# mate — Zerops Mate

Zerops Mate is a hard fork of T3 Code: a control surface for coding agents. Its server runs inside a
Zerops `zcp` container under `/mate/`, spawning Claude Code / Codex with ZCP's MCP tools attached;
its client — web, desktop, mobile — is the product surface a Zerops user signs into.

## Where knowledge lives

This file is a MAP, not a knowledge store — it never caches a product fact that already lives in
the spec or the ledger. To answer a question, go to the home:

| Knowledge                                                                                                                | Home                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Design / workflow decision                                                                                               | `../zcp/docs/spec-mate.md`                                                         |
| Fork rules — zones, freeze, keep/delete, work loop, intake                                                               | `docs/internals/zerops/fork.md`                                                    |
| Provider runtime SPI contract — version, delivery guarantee, enrichment, typed capabilities, fixtures, porting checklist | `docs/internals/zerops/spi.md`                                                     |
| Per-port compatibility matrix                                                                                            | `docs/internals/zerops/compat.md`                                                  |
| Measured facts (dated, one writer)                                                                                       | the ledger: `docs/internals/zerops/{verified,questions,hacks,map,poc-findings}.md` |
| Client design system — vocabulary, glossary, icon map, rules R1–R8 with their tests, exception ledgers                   | `docs/internals/zerops/design-system.md`                                           |
| Behavior invariant                                                                                                       | a test                                                                             |
| Transient roadmap / journal                                                                                              | `../zcp/plans/` (never cite as a source)                                           |
| Upstream agent guide (still accurate below the banner)                                                                   | `AGENTS.md`                                                                        |

## Zones

| Zone                                                                                                                                                                                                                                                                     | Rule                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **Import** — wire-protocol packages (`packages/effect-codex-app-server`, `packages/effect-acp`)                                                                                                                                                                          | byte-identical, re-imported from an upstream SHA in one commit, pinned by `imported.lock`  |
| **Port** — provider drivers (`apps/server/src/provider/**`, provider contracts)                                                                                                                                                                                          | ported behind the adapter SPI, our edits stay minimal so ports stay cheap                  |
| **Owned** — the rest of `apps/server`, shared packages, desktop, mobile                                                                                                                                                                                                  | ours; upstream changes are optional cherry-picks                                           |
| **Owned product** — `apps/server/src/zerops/**`, `apps/web/src/zerops/**`, `apps/web/src/components/zerops/**`, `packages/client-runtime/src/zerops/**`, `apps/mobile/src/features/zerops/**`, `packages/shared/src/{brand,threadStatus}.ts`, `docs/internals/zerops/**` | ours only; the client design system rules live in `docs/internals/zerops/design-system.md` |

Full map, `imported.lock` enforcement, and the adapter SPI contract: `docs/internals/zerops/fork.md` §3.

## Commands

- `vp test run <file>` — targeted tests for what you touched, never the repo-wide suite.
- Package `typecheck` (scoped to the package you changed), never repo-wide.
- Before a push: `vp check` on the touched files; a deletion must also pass
  `node scripts/check-guard-exceptions.ts` and `vp test run scripts/surface-manifest.test.ts` — CI's
  Check job reconciles the guard ledgers and `docs/internals/zerops/surfaces.json` against the tree.
- Delivery to a running container is the push loop, not a release:
  `../zcp/eval/scripts/mate-dev-push.sh`. A container restart wipes a dev build; push again after.

## Disciplines

- TDD: RED → GREEN, table-driven tests.
- Atomic commits, English, never a `Co-Authored-By` trailer.
- Delete, don't disable — no commented-out code or compat shims.
- Ported-zone edits stay minimal; a diverged port is an expensive port next time.
- The ledger has one writer — subagents report facts as text, never edit `verified.md` /
  `questions.md` / `hacks.md` / `map.md` / `poc-findings.md` directly.
- Raw WebSocket probes (`subscribe*`) send `Ack` after every `Chunk` — an idle connection dies at
  the Zerops L7 after 60s.

## Maintenance

CLAUDE.md earns a line only for a cross-cutting trap or a discipline that isn't test-/spec-shaped.
A design decision belongs in `../zcp/docs/spec-mate.md`; a fork rule in `fork.md`; a measured fact
in the ledger. When one of those already states it, delete the line here.
