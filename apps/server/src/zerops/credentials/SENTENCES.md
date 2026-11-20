next: CR12

- CR1 — The Mate's own Zerops key is the env store's `ZCP_API_KEY` when the store carries one, the boot snapshot when it carries none, and when the store cannot be read the last key read from it, else the snapshot
- CR2 — An env store whose `ZCP_API_KEY` is blank, not a string or missing, or which is not a flat object, carries no key, and a key's surrounding whitespace is not part of it
- CR3 — The Mate's key is read again when the env store changes, and never because time passed
- CR4 — An own-key request refused with 401 or 403 is sent once more with the key read again, and a key still refused is not tried a third time
- CR5 — With no key at all, no own-key request is sent
- CR6 — The Observe credential is kept whole in a file only its user can read (0600), in a directory only its user can enter (0700), replaced in one rename that leaves no staged file
- CR7 — Revoking the Observe credential reports success once the file is gone, an absent file included, and a write or removal that fails reports failure and leaves what was there
- CR8 — A revocation that arrives while the Observe credential is being written waits for the write, so the credential ends removed
- CR9 — Outside a Zerops container Observe delivery is refused, and inside one the credential goes to `.zcp/hq/observe-credential` under the Mate's home, never among the Mate's secrets
- CR10 — HQ's Git credential is kept whole in a file only its user can read (0600), replaced in one rename that leaves no staged file, and HQ's revocation removes it, a revocation with no file being no fault
- CR11 — The Mate reports the fingerprint of the Git credential it holds as the SHA-256 of the credential's SHA-256, and none while it holds none
