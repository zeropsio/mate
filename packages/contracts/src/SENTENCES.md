next: CT9

- CT1 — A list or union member from a newer build is dropped or read as unknown, while a known member with a broken payload still fails
- CT2 — An engine event from a newer build decodes as Unknown in its place and run, and a known event with a damaged body is refused
- CT3 — An older client reads a newer engine's frame: an unknown record kind keeps its place and a damaged record is dropped alone, never the frame
- CT4 — A secret's answer on the wire says only how it ended, and a value sent with it never decodes
- CT5 — A ref name git would read as an option is refused wherever a ref crosses the wire
- CT6 — A usage identity with an unpaired surrogate is refused, so HQ is never sent a fact it cannot read
- CT7 — A message of kind notice decodes with the change it is about and no sender; an ask or an answer without its sender, and a notice without its change, are refused
- CT8 — A person's message carrying a task whose source kind a newer build added is read with that task as unknown, while a known source with a broken payload drops the message alone; breaks: an older tab drops a task's whole message, the person's words with it
