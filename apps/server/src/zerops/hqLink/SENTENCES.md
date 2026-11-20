next: HL17

- HL1 — A link opens at HQ's link address with the project's key in its first frame and nothing in the URL, answers only pings until HQ's first state, then sends the whole overview, and the next link presents the key the container holds then
- HL2 — A link's hello names the fingerprint of the Git credential the Mate holds, read afresh at every dial, and none while it holds none
- HL3 — A Mate whose public origin is unknown dials nothing and says its link is withheld for it, and one whose container holds no key dials nothing until a key appears
- HL4 — A link whose HQ sends no state within 30 s of opening is closed and dialled again, its pings answered meanwhile, while an admitted link is kept until it closes
- HL5 — A link that hears nothing for three of the ping intervals HQ announced is closed and dialled again though its socket never reports closed, and a superseded link's deadline never closes its successor
- HL6 — The Git credential HQ sends is handed on, and so is HQ's revocation of it
- HL7 — An Observe credential HQ sends is acknowledged with its writer's own receipt, and refused when the Mate has no writer for it
- HL8 — HQ's refusal of the key, with HQ's reason, stands until HQ next sends a state, and a refused key is dialled again only after the re-ask while its store stays put
- HL9 — A link HQ superseded is followed by a new one after the shortest wait, while each link that closes right after it opened waits longer than the last
- HL10 — A quiet link sends nothing and reads nothing: the overview is read again only when something changed
- HL11 — HQ is resolved over IPv6 only, even when the connection asks for IPv4, and an answer that maps to IPv4 is refused
- HL12 — A refusal by Zerops of the key HQ admitted, which the container still holds, is reported to HQ in one key-refused frame, and again on the next link when that send was lost, while a link after the key changed stays open
- HL13 — Only Zerops' 401 accuses the Mate key: a resource's 403, a 5xx or a timeout reports nothing and keeps the link
- HL14 — A chat whose read fails stays held in the Mate's attention, while a chat no longer active or now another project's leaves it
- HL15 — Each attention revision is published once: an event that changes nothing publishes nothing
- HL16 — Each start counts its epoch one past the saved one, 1 when none is saved, and saves it before use, while a saved epoch that is no positive whole number is refused and left as it was
