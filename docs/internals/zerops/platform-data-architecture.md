# Platform editing rules

Forms distinguish the base observation, current source data and unsaved edits. Source updates must
not overwrite local edits. Resolve conflicting fields before a replacement write; discarding edits
returns to current source data.

A local timestamp or a read before a write cannot prevent lost updates. Use conditional writes
only where the source enforces their preconditions.

Link asynchronous work only through verified source identities and relationships. Time proximity
or a shared hostname cannot establish causality.
