# Design decisions — the dated log

Moved out of `design-system.md` §6 on 2026-09-30: the working spec stays short, the log only
grows. Newest entries last; grep by date or by a surface's name.

Decisions the plan did not foresee, taken by the orchestrator from the plan's rules and noted
here (the owner decides only what the orchestrator brief §6 lists).

- **2026-10-04** — **0.13's rebuild keeps what 0.12.3 shipped (pass 40).** An audit checked 694 commits
  from 0.11.80 to 0.12.3 against 0.13.0, the release that replaced the Gitea backbone with HQ.
  - 534 kept every line. Of the other 160, most were kept or rebuilt on HQ; the Gitea plumbing went
    with Gitea.
  - Merge resolutions dropped two behaviours, and the rebuild reversed several on purpose. This pass
    restores both kinds on HQ, below.
  - Where 0.13 carries out an owner decision (D6, ADR 0003), the decision stands and only its fallout
    is fixed.
  - _Why:_ the owner: "we should fix everything, we have the knowhow of what we worked on".
