next: AU18

- AU1 — Inside a Zerops container the server offers only the Zerops ticket door and bearer access tokens, and counts as remote-reachable though it binds loopback
- AU2 — Outside a Zerops container the server offers no bootstrap door, on loopback or beyond
- AU3 — A hosted web server's session cookie is `t3_session` whatever its port, host or state directory, while a development server's carries its port and a hash of its state directory, on loopback and on a wildcard host alike
- AU4 — `localhost`, every `127.` address and `::1` count as loopback, and the wildcard and any other address as reachable from outside
- AU5 — A DPoP proof whose replay marker already exists is refused as an invalid credential, and any other replay-store failure is an internal error, never a refusal
- AU6 — A live connection's session ends as expired when its own deadline passes and as revoked when its own session is removed, never for another session's removal, and a session with no deadline is never ended by the clock
- AU7 — The replay sweep deletes only replay markers older than a day, never another secret, a marker exactly a day old, or a pending write's temporary file
- AU8 — The server's secrets directory is readable by its own user only (0700) and each secret file too (0600)
- AU9 — Two creators racing for one missing secret both get the one value that was persisted
- AU10 — A Zerops ticket opens one connection once and carries no role, and an unknown, foreign or malformed first frame consumes none
- AU11 — A ticket expires at most 60 seconds after it was issued, and sending it again never renews it
- AU12 — A sign-out refuses every ticket issued before the connection opened, as well as the connection's own
- AU13 — A login whose credential was logged out keeps its last signer as history, which never authorizes a turn
- AU14 — In someone else's Mate a colleague, a project admin included, only reads along: every acting call (message, stop, answer, terminal, command, Git, agent sign-in, settings, MCP, crew press) is refused before its handler runs, reading calls stay open, and only its owner or an admin of its project updates the Mate
- AU15 — Every RPC of the server's group declares exactly one scope, checked before its handler runs, and an RPC name without one is refused
- AU16 — Inside Zerops an HTTP request is admitted on a ticket's connection only while that connection lives and loses access at the same sign-out or refusal that ends the socket; a cookie or upgrade credential is refused even when it names a live connection
- AU17 — A session token is accepted only with the server's signature and before its expiry on the injected clock, and a websocket token only while its parent session lives
