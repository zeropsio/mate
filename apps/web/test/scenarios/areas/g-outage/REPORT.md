G: outages, sleep and several tabs — hosted client against real HQ Core.

Scenario · status · bug caught · temporary negative proof:

- HQ down opens/chats · green · HQ loss blocks a retained Mate · disabled Mate message acceptance; acceptance/timeline assertion failed.
- HQ return rename · green · pre-outage menu remains · sent a different rename; expected visible name failed.
- Consecutive HQ outages · green · second recovery restores an older name · changed second rename input; latest-name assertion failed.
- Hour-long sleep/wake · green · waking keeps the old menu · renamed to a different name while frozen; post-wake name failed.
- Two account tabs · green · one tab misses a live change · sent a different rename; expected tab name failed.
- Close second tab · green · remaining tab loses its live account/subscriptions · sent a different rename after close; surviving-tab name failed.
- Zerops down menu/chat · green · platform loss clears menu or blocks connected chat · disabled Mate message acceptance; acceptance/timeline assertion failed.
- Corrupt HQ record · green · one unreadable Mate erases unrelated facts · corrupted Bea instead of Ada; Ada-removal assertion failed.
- HQ down keeps task · green · known task text disappears · corrupted Ada after the task was visible; retained-task assertion failed.
- HQ down keeps question · fails · last known pending question disappears · removed `.fails`; failed with “Last known pending question disappeared during HQ outage”.
- Pings without fresh facts · fails · stale menu still appears live · removed `.fails`; failed with “HQ still appears live after nine pings without fresh facts”.

All nine green mutations failed; all restored. No application/shared files changed.
Shared-file change requests: none.
Driver checks: HTTP forwarding, isolated snapshot corruption, fact suppression, acknowledged pings (2 tests).
Validation: targeted lint and scenario TypeScript project pass; upstream HQ suggestions only.

Fidelity gaps:

- CDP freeze/thaw leaves headless Chrome hidden. Area-only focus emulation models returning to the woken tab; sibling tabs are brought forward before assertions.
- Browser time advances virtually; HQ/network time remains native. Nine acknowledged 20-second heartbeats span 180 seconds virtually; sleep spans one hour. No wall-clock performance assertion.
- UI/receipt deadlines are 10 seconds (the shared composer check uses 15), versus ordinary fixture/interaction completion around 2–3 seconds on this loaded laptop.
- Zerops outage means HTTP 503 plus closed sockets; this case preserves menu/chat, but does not assert a Zerops-specific catching-up label (the menu exposes HQ reconnect status).
- Corruption replays a captured real HQ snapshot with only one Mate value made unreadable. Mate/provider execution remains synthetic.

Three consecutive area runs: 72.75 s, 87.82 s, 79.84 s including the production builds; each had 9 green + 2 expected failures.
Commit: `test(scenarios): g-outage covers outages, sleep and tabs` (hash reported on delivery).
