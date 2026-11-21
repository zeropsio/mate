next: SP9

- SP1 — A tool item the bus recognizes reaches its subscribers with the tool call's name and result text added, and every other event reaches them unaltered, in the order the provider published them
- SP2 — A tool item whose data the bus cannot read still reaches its subscribers, without a tool call, and every occurrence is reported on the enrichment-failure stream with its event id, provider and item type
- SP3 — A provider update waits while any session is opening, running, on a turn or failed for an unknown reason; only idle sessions let it go
- SP4 — A remote MCP server's sign-in is answered by a listener in the container only when its redirect is a plain-http loopback address; any other goes back through the Mate's page
- SP5 — Claude turn usage counts its own and its child models' tokens and cost once, from the native ledger, without restored history or the assistant, Task and main-only meters
- SP6 — An OpenCode turn counts each step once under the model that ran it, subagents included; a step without a cost leaves its model's cost unknown, never free
- SP7 — A Codex turn counts each of its own responses once, and conflicting retries fail instead of inflating the count
- SP8 — A provider session whose open turn the engine leaves to the restart holds no update, while another session with a turn open still holds it. Breaks: a question waiting on its person keeps its Mate from every release through its live session.
