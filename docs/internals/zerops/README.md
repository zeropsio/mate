# Zerops integration — field notes

The knowledge behind running the z3 server inside a Zerops `zcp` container and driving it from
the z3 client. Started during the 2026-08 proof of concept (tag `poc-2026-08-28`), kept because
the product is built from `upstream/main` with everything the POC learnt and none of its code —
the real implementation needs to know what was measured, what was faked and why.

**The plan lives elsewhere:** `../../../../zcp/plans/z3-brief-2026-08-28.md` (streams S0–S7,
decisions, the dev loop) with its depth in `z3-concept-2026-08-28.md` next to it. These notes are
the reference the plan cites; they hold no plan of their own.

## The files

| File                                   | Holds                                                                                                                                                           | Lifecycle                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`map.md`](map.md)                     | The systems and every channel between them                                                                                                                      | Changes when a channel is added or removed                                                   |
| [`verified.md`](verified.md)           | Facts measured against real systems                                                                                                                             | Each entry decays; re-verify before trusting                                                 |
| [`hacks.md`](hacks.md)                 | Shortcuts (POC and dev-loop) and what the real fix is                                                                                                           | Entries die when paid back                                                                   |
| [`questions.md`](questions.md)         | Unknowns that block real implementation                                                                                                                         | Entries die when answered — move the answer to `verified.md`                                 |
| [`poc-findings.md`](poc-findings.md)   | What the POC taught: the T3 seam map + functional facts, and where its code sits                                                                                | Frozen with the tag; a seam that moves upstream gets a note                                  |
| [`fork.md`](fork.md)                   | The fork rules: hard-fork decision, freeze, zones, keep/delete, work loop, intake ritual                                                                        | Changes when a rule changes; the freeze checklist status moves as items land                 |
| [`intake.md`](intake.md)               | Last-reviewed upstream SHA, the decisions taken, open security candidates                                                                                       | One row per intake cycle                                                                     |
| [`spi.md`](spi.md)                     | The provider runtime SPI contract: boundary, version/changelog, event kinds, delivery guarantee, enrichment, typed capabilities, fixtures, porting checklist    | Changes when the SPI version bumps or a capability/fixture/porting step changes              |
| [`compat.md`](compat.md)               | Per-port compatibility matrix: ported upstream SHA × CLI/SDK/Effect versions × fixture set                                                                      | One row per port, never edited in place                                                      |
| [`design-system.md`](design-system.md) | The client design system's working spec: component vocabulary, copy glossary, icon map, rules R1–R8 with their tests, exception ledgers, in-programme decisions | Rows fill as slices land; decisions promote to `spec-z3.md`; ledger sizes move at every wave |

## Rules for adding to this

- **Date every fact and say how it was measured.** A claim with no date is a rumour six weeks
  later. Prefer a command someone can re-run over a sentence they have to trust.
- **A hack is only a hack if it is written down.** Anything knowingly wrong, temporary, or
  papered over goes in `hacks.md` the moment it is done, not at the end.
- **Answered questions leave `questions.md`.** They become a `verified.md` entry or a `map.md`
  edit. The file should shrink as the work proceeds.
- **One fact per entry.** Do not write paragraphs. This is a reference, not a narrative.
- **No plans here.** Plans live in `../zcp/plans/` (transient) and are promoted into
  `../zcp/docs/spec-z3.md` when decided.

## Repos this touches

| Repo              | What it is                                                          | Path                 | Read it at                                                                                              |
| ----------------- | ------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| `z3`              | This fork of T3 Code — z3 server + web/desktop/mobile clients       | .                    | **`z3`** (product, from `upstream/main`); `zerops-poc` / tag `poc-2026-08-28` = the POC, reference only |
| `zcp`             | The Go binary that runs inside the container: init, nginx, MCP      | `../zcp`             | `main` for the product; `feat/z3-container` (`7c98c793`) = the POC's zcp half, the seed for stream S2   |
| `zcli`            | The user's laptop CLI — VPN, project/service ops                    | `../zcli`            | `main`; not on the product path                                                                         |
| `frontend-legacy` | The official Zerops web app — reference for auth/registration flows | `../frontend-legacy` | `main`                                                                                                  |

`zcp@1` — the container base image itself — is platform-owned and lives in none of these.

### Reading POC-era entries

Entries dated before 2026-08-28 whose **Where** is `zcp` cite paths (`/z3-pair`, `/healthz`
locations in `nginx.conf.tmpl`, `internal/z3`, `internal/z3sidecar`, `cmd/zcp/z3sidecar.go`,
`deploy/zcp-container.yml`) that exist **only** on `zcp` branch `feat/z3-container`, never on
`main`. Entries whose **Where** is this fork cite paths that exist only at tag `poc-2026-08-28`
(`git show poc-2026-08-28:<path>`); `poc-findings.md` says which of them still matter.
