# Zerops integration — field notes

The knowledge behind running the mate server inside a Zerops `zcp` container and driving it from
the mate client. Started during the 2026-08 proof of concept (tag `poc-2026-08-28`), kept because
the product is built from `upstream/main` with everything the POC learnt and none of its code —
the real implementation needs to know what was measured, what was faked and why.

**The plan lives elsewhere:** `../../../../zcp/plans/` — the 2026-08-28 brief (streams S0–S7) and,
since 2026-09-15, the auth-backbone guide. **Where the project stands** — every slice's state, what is
proven, what is open — is [`primer.md`](primer.md). These notes are the reference both cite; they hold
no plan of their own.

## The files

- **[`primer.md`](primer.md)** — Where the whole stands: the parts and their homes, who holds what,
  the run as measured, every slice's state against the plan, what is open
  - _Lifecycle:_ Changes in the commit that changes the fact
- **[`map.md`](map.md)** — The systems and every channel between them
  - _Lifecycle:_ Changes when a channel is added or removed
- **[`verified.md`](verified.md)** — Facts measured against real systems
  - _Lifecycle:_ Each entry decays; re-verify before trusting
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
- **[`design-system.md`](design-system.md)** — The client design system's working spec: component
  vocabulary, copy glossary, icon map, rules R1–R11 with their tests, exception ledgers
  - _Lifecycle:_ Entries fill as slices land; ledger sizes move at every wave
- **[`design-decisions.md`](design-decisions.md)** — The design decisions taken inside the
  programme, dated, one entry each; grepped, never read whole
  - _Lifecycle:_ Append-only; a decision promotes to `spec-mate.md`
- **[`test-accounts.md`](test-accounts.md)** — How a person signs in through the hand-over, and how
  an agent signs a dev build in as several Zerops accounts (`signInAs`, `window.__mateDev`)
  - _Lifecycle:_ Changes when the hand-over or the dev hook changes
- **[`data-layer.md`](data-layer.md)** — Shared ownership, observation, demand and operation rules
  - _Lifecycle:_ Changes when a rule across data families changes

## Rules for adding to this

- **Date every fact and say how it was measured.** A claim with no date is a rumour six weeks
  later. Prefer a command someone can re-run over a sentence they have to trust.
- **A hack is only a hack if it is written down.** Anything knowingly wrong, temporary, or
  papered over goes in `hacks.md` the moment it is done, not at the end.
- **Answered questions leave `questions.md`.** They become a `verified.md` entry or a `map.md`
  edit. The file should shrink as the work proceeds.
- **One fact per entry.** Do not write paragraphs. This is a reference, not a narrative.
- **No plans here.** Plans live in `../zcp/plans/` (transient) and are promoted into
  `../zcp/docs/spec-mate.md` when decided.

## Repos this touches

| Repo              | What it is                                                          | Path                 | Read it at                                                                                                |
| ----------------- | ------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| `mate`            | This fork of T3 Code — mate server + web/desktop/mobile clients     | .                    | **`main`** (product, from `upstream/main`); `zerops-poc` / tag `poc-2026-08-28` = the POC, reference only |
| `zcp`             | The Go binary that runs inside the container: init, nginx, MCP      | `../zcp`             | `main` for the product; `feat/z3-container` (`7c98c793`) = the POC's zcp half, the seed for stream S2     |
| `zcli`            | The user's laptop CLI — VPN, project/service ops                    | `../zcli`            | `main`; not on the product path                                                                           |
| `frontend-legacy` | The official Zerops web app — reference for auth/registration flows | `../frontend-legacy` | `main`                                                                                                    |

`zcp@1` — the container base image itself — is platform-owned and lives in none of these.

### Reading POC-era entries

Entries dated before 2026-08-28 whose **Where** is `zcp` cite paths (`/z3-pair`, `/healthz`
locations in `nginx.conf.tmpl`, `internal/mate`, `internal/z3sidecar`, `cmd/zcp/z3sidecar.go`,
`deploy/zcp-container.yml`) that exist **only** on `zcp` branch `feat/z3-container`, never on
`main`. Entries whose **Where** is this fork cite paths that exist only at tag `poc-2026-08-28`
(`git show poc-2026-08-28:<path>`); `poc-findings.md` says which of them still matter.
