next: CT6

- CT1 — A list or union member from a newer build is dropped or read as unknown, while a known member with a broken payload still fails
- CT2 — An engine event from a newer build decodes as Unknown in its place and run, and a known event with a damaged body is refused
- CT3 — An older client reads a newer engine's frame: an unknown record kind keeps its place and a damaged record is dropped alone, never the frame
- CT4 — A secret's answer on the wire says only how it ended, and a value sent with it never decodes
- CT5 — A ref name git would read as an option is refused wherever a ref crosses the wire
