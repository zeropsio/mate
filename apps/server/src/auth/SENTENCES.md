next: AU10

- AU1 — Inside a Zerops container the server offers only the Zerops ticket door and bearer access tokens, and counts as remote-reachable though it binds loopback
- AU2 — Outside a Zerops container the server offers no bootstrap door, on loopback or beyond
- AU3 — A hosted web server's session cookie is `t3_session` whatever its port, host or state directory, while a development server's carries its port and a hash of its state directory, on loopback and on a wildcard host alike
- AU4 — `localhost`, every `127.` address and `::1` count as loopback, and the wildcard and any other address as reachable from outside
- AU5 — A DPoP proof whose replay marker already exists is refused as an invalid credential, and any other replay-store failure is an internal error, never a refusal
- AU6 — A live connection's session ends as expired when its own deadline passes and as revoked when its own session is removed, never for another session's removal, and a session with no deadline is never ended by the clock
- AU7 — The replay sweep deletes only replay markers older than a day, never another secret, a marker exactly a day old, or a pending write's temporary file
- AU8 — The server's secrets directory is readable by its own user only (0700) and each secret file too (0600)
- AU9 — Two creators racing for one missing secret both get the one value that was persisted
