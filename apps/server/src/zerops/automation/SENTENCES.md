next: AM19

- AM1 — A Mate is automated only once HQ says it is, and HQ's last word on it wins
- AM2 — An automated Mate starts automated again after a restart, before HQ speaks, and a Mate HQ last called ordinary starts ordinary
- AM3 — An automated Mate's agents start on the organization's model once HQ hands it, again after a restart, and on the default once HQ names none
- AM4 — A model outside the offered list, of the same provider or another, is refused and the default runs
- AM5 — An automated Mate sets the organization's key on its default OpenCode as a secret variable and turns OpenCode on, and an ordinary Mate sets none
- AM6 — Keys heard before HQ says the Mate is automated are set once it does
- AM7 — An empty key list clears the key the Mate set
- AM8 — The same key told again, or HQ's same word again, writes the settings no second time
- AM9 — A key the Mate could not set never reaches a log line
- AM10 — A task's stop, limits, spending and turns outlive the Mate's restart
- AM11 — A ledger write the Mate could not finish leaves the last whole ledger, never a half-written one
- AM12 — A new task moves a working copy to main, first stashing its uncommitted work and keeping its unpushed commits on a `mate-kept/` branch named after the task the copy held and its commit
- AM13 — A follow-up starts on its own change's branch only in the repository that holds that change, and on main in every other
- AM14 — Commits kept again after more work get a branch of their own, and a kept branch is never written over
- AM15 — A task's working copy tracks the base it starts from, never the change an earlier task pushed
- AM16 — A pool container a thread's agent leased is never put on a task's base nor named as holding undelivered work
- AM17 — A failing git step leaves its working copy as it was and names it, while the other working copies move on
- AM18 — The working copies holding undelivered work (uncommitted files, or commits on no remote branch) are named by a read that changes nothing, never one of no repository on HQ's git, and new files count only where the task's work started clean
