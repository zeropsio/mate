next: BT10

- BT1 — A command that arrives before the server is ready waits, and runs exactly once when readiness is signalled
- BT2 — When the server fails to start, a command waiting for readiness fails with the startup error and never runs
- BT3 — The welcome names the project after the last segment of the server's working directory
- BT4 — With auto-bootstrap on, the project already at the working directory is kept and nothing is dispatched
- BT5 — With auto-bootstrap on, a working directory without a project gets exactly one project create, carrying no model selection, and no thread
- BT6 — At startup the Mate engine boots and its opening runs in the reactor scope
- BT7 — The announced address is `localhost` when no host is set, keeps an explicit host with an IPv6 address in brackets, and turns a wildcard host into the machine's external IPv4 address
- BT8 — The announced port is the port the server actually bound, the configured one only when no bound port is known
- BT9 — A Zerops container announces its address and the HQ it is opened through, by default `https://mate-hq.zerops.io`, and never a token, a pairing link or a QR code
