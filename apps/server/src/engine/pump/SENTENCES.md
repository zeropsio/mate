next: PU8

- PU1 — A provider call the host is making (a deferred interrupt, a session close nobody asked for) holds a Mate update back until the call settles, then lets it go; breaks: an update kills the server in the middle of a provider call
- PU2 — A send's evidence reaches it even when the driver answered before the send waited; breaks: the send waits for an answer that already came
- PU3 — A batch the actor fails to take is told again until it takes it, so a turn's end is never lost; breaks: the run shows running for good
- PU4 — A Zerops result's pictures reach the record as references to the Mate's assets, never as bytes; breaks: picture bytes swell the record and every client's frame
- PU5 — A page the Mate publishes is recorded on its call by reference, with its title, size and time; breaks: the call card cannot open the page
- PU6 — A workspace picture a call looked at is named by its asset; breaks: the call card shows a path the browser cannot read
- PU7 — A session that ended without the engine asking keeps the words it ended in for a send that then finds it gone, while a live session and a close the engine asked for give none; breaks: a send into a Claude session that failed before its first turn says only that the session was not live (live check, 2026-11-20)
