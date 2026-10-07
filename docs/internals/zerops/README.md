# Zerops integration — field notes

Shared terms, rules and platform assumptions for running Mate in Zerops. Product behavior lives
in tests, implementation in code, and reasons and reversals in git history. The zcp↔mate seam
lives in `../../../../zcp/docs/spec-mate.md` §2.8.

## The files

- **[`primer.md`](primer.md)** — Domain terms for Mate, HQ, applications, environments and crew
- **[`data-layer.md`](data-layer.md)** — Shared ownership, observation, demand and operation rules
- **[`map.md`](map.md)** — The systems and every channel between them
  - _Lifecycle:_ Changes when a channel is added or removed
- **[`verified.md`](verified.md)** — Relied-on platform facts and commands to re-check them
- **[`hacks.md`](hacks.md)** — Shortcuts (POC and dev-loop) and what the real fix is
  - _Lifecycle:_ Entries die when paid back
- **[`questions.md`](questions.md)** — Unknowns that block real implementation
  - _Lifecycle:_ Entries die when answered — move the answer to `verified.md`
- **[`poc-findings.md`](poc-findings.md)** — What the POC taught: the T3 seam map + functional
  facts, and where its code sits
  - _Lifecycle:_ Frozen with the tag; a seam that moves upstream gets a note
- **[`fork.md`](fork.md)** — The fork rules: hard-fork decision, freeze, zones, keep/delete, work
  loop, intake ritual
  - _Lifecycle:_ Changes when a rule changes; the freeze checklist status moves as items land
- **[`intake.md`](intake.md)** — Last-reviewed upstream SHA, the decisions taken, open security
  candidates
  - _Lifecycle:_ One row per intake cycle
- **[`spi.md`](spi.md)** — The provider runtime SPI contract: boundary, version/changelog, event
  kinds, delivery guarantee, enrichment, typed capabilities, fixtures, porting checklist
  - _Lifecycle:_ Changes when the SPI version bumps or a capability/fixture/porting step changes
- **[`compat.md`](compat.md)** — Per-port compatibility matrix: ported upstream SHA × CLI/SDK/Effect
  versions × fixture set
  - _Lifecycle:_ One row per port, never edited in place
- **[`design-system.md`](design-system.md)** — Shared principles, copy, tokens, guard rules and
  exception policy
- **[`test-accounts.md`](test-accounts.md)** — How a person signs in through the hand-over, and how
  an agent signs a dev build in as several Zerops accounts (`signInAs`, `window.__mateDev`)
  - _Lifecycle:_ Changes when the hand-over or the dev hook changes

## Rules for adding to this

Follow `CLAUDE.md`'s “What a doc may hold”. Keep a shared rule or term in one home. A platform
assumption belongs beside the dependent code or in a short ledger entry with its verification
command. A surface's behavior belongs in its tests; its appearance belongs in code. Keep plans
and run evidence local, and reasons and reversals in commit messages.

## Repos this touches

| Repo              | What it is                                                          | Path                 | Read it at                                                                                                   |
| ----------------- | ------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `mate`            | This fork of T3 Code — mate server + web/desktop/mobile clients     | .                    | **`main`** (product; fork rules in `fork.md`); `zerops-poc` / tag `poc-2026-08-28` = the POC, reference only |
| `zcp`             | The Go binary that runs inside the container: init, nginx, MCP      | `../zcp`             | `main` for the product; `feat/z3-container` (`7c98c793`) = the POC's zcp half, the seed for stream S2        |
| `zcli`            | The user's laptop CLI — VPN, project/service ops                    | `../zcli`            | `main`; not on the product path                                                                              |
| `frontend-legacy` | The official Zerops web app — reference for auth/registration flows | `../frontend-legacy` | `main`                                                                                                       |

`zcp@1` — the container base image itself — is platform-owned and lives in none of these.

### Reading POC-era entries

Entries dated before 2026-08-28 whose **Where** is `zcp` cite paths (`/z3-pair`, `/healthz`
locations in `nginx.conf.tmpl`, `internal/mate`, `internal/z3sidecar`, `cmd/zcp/z3sidecar.go`,
`deploy/zcp-container.yml`) that exist **only** on `zcp` branch `feat/z3-container`, never on
`main`. Entries whose **Where** is this fork cite paths that exist only at tag `poc-2026-08-28`
(`git show poc-2026-08-28:<path>`); `poc-findings.md` says which of them still matter.
