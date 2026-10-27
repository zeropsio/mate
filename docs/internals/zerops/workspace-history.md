# Workspace history rules

Workspace history describes observed changes, not exclusive authorship by an agent. A directory
or hostname is an address; neither proves service identity nor that deployed files are sources.

zcp owns provisioning, adoption, mounting, delivery and Git preparation. Mate consumes that seam;
it must not reinterpret or rewrite raw zcp state. The contract lives in
`../../../../zcp/docs/spec-mate.md`.

Restoring observed workspace history requires exact membership, current-content checks and
partial-failure recovery. A partial restore must never rewind the conversation.
