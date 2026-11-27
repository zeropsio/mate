next: TA13

- TA1 — A turn on a login its person signed in here, or on an agent a project token authorizes, is admitted
- TA2 — A turn on a login that is not signed in, whose sign-in nobody recorded, or that another member signed in is refused and names that login: an agent's own login by its agent id, a login beyond the defaults by its own id
- TA3 — A login whose sign-in must be renewed or reconnected is refused as expired; any other login that is not signed in, as missing its sign-in
- TA4 — While HQ's map of signers is unheard, a turn on a login with no signer on record is undetermined, never refused, and names no login
- TA5 — A crew turn on a login its starter signed runs only while HQ says the starter may run turns here: lost access refuses, and HQ's silence is undetermined
- TA6 — HQ's standing is asked only for a crew turn on a login its starter signed: a stand-up, a person's own session and a crew turn on a project token run whatever HQ says
- TA7 — Where only the organization's key may run, a subscription sign-in or login is refused even for its own signer; an API key login and an instance with no agent run
- TA8 — A turn refused for more than one reason is refused for the first of: its starter's standing, the organization's key, its login
- TA9 — Another Mate's message runs only on a login its owner signed in here: on a project token or an agent nobody lists it is refused for now, and on a login another member signed it is refused for good
- TA10 — A turn whose instance resolves to no agent, or to an agent the auth feed does not list, passes unjudged
- TA11 — While HQ cannot say a starter's standing, the last standing heard for them decides for at most 15 minutes and nothing decides after; a later answer replaces an earlier one, and a verdict the server does not know never clears one heard
- TA12 — A message to a Mate with no conversation, or whose main conversation has no agent, gives that conversation the first agent its owner signed in that admits the message, and waits while the stand-up may still open it or no agent of its owner's admits it; breaks: a new Mate never works another Mate's message, or opens a second conversation beside its stand-up's
- TA+1 — A check notice runs on an admitted owner login, waits while its login or admission is unknown, and ends with no-agent or usage-limit only when no other owner login can run; breaks: a failed check waits forever or an unresolved sign-in is handed to a person too soon
