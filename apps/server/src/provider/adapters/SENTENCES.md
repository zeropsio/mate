next: PA10

- PA1 — Under supervised, auto-accept-edits and auto, OpenCode reads, searches and updates tasks in the workspace without asking, asks before reading an env file but not its example, and asks before a command, a web fetch or search, an outside directory, a repeated loop or an unknown tool
- PA2 — OpenCode pre-approves edits only under auto-accept-edits, keeps asking under supervised and auto (it has no reviewer), and allows everything, outside directories included, only under full access
- PA3 — In every supervised mode OpenCode runs the Zerops tools (`zerops_…`) without asking, and still asks for a tool whose name only starts with `zerops`
- PA4 — A person's approval reaches OpenCode as once for accept, always for this thread and for always, and reject for decline and for cancel
- PA5 — The OpenCode server password is the settings' one when set; otherwise a local server takes the launch environment's, and an external server never gets an inherited or launch-environment password
- PA6 — Mate accepts an OpenCode server at v1.14.19 and refuses one below it or one whose health answer is unhealthy, unversioned or not a version
- PA7 — A Codex child agent's lifecycle (turn start and end, thread status, usage, settings, model reroute, items, close, error) becomes agent events, its streaming chatter is dropped, and no child-owned thread lifecycle reaches the parent
- PA8 — A child notification the parent owns (`serverRequest/resolved`) or one the router does not know goes to the parent, never lost
- PA9 — A folder whose commands did not come is scanned again once its agent's install, version, enabled state, status, sign-in or machine commands change, and never on a change of usage or check time alone
