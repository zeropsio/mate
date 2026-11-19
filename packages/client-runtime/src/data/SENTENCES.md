next: ST13

- ST1 — Input that a superseded attempt delivers late is ignored
- ST2 — A baseline is committed at once, and the changes that arrived while it was read are replayed on it
- ST3 — A fact is deleted only on proof: transport events and absence keep it
- ST4 — A member listed before its row is asked for; a row that arrives before its member stays unlisted
- ST5 — A process that starts and finishes inside one batch is never lit as running
- ST6 — An engine conversation's records are ordered by epoch, then sequence
- ST7 — A forgotten conversation's memberships, coverage and index entries are dropped, never claimed deleted
- ST8 — An HQ record a reset leaves out is kept: only an explicit removal takes it
- ST9 — A delivery of a superseded HQ registration is fenced out whole
- ST10 — HQ scopes' coverage is complete only when HQ says catchup ended
- ST11 — A pushed Zerops version, HQ revision or Mate link reading replaces the held one only when it is newer in the same source, and never one of another source
- ST12 — Another HQ incarnation replaces what is held only through a baseline, never through a push
