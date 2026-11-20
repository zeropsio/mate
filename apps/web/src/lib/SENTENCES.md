next: WL2

- WL1 — A terminal context whose captured text is gone, nothing but line breaks left, is not sent; one that still holds text is sent, in its order
- WL+1 — A message waits while any of its attachments is missing, uploading or failed, and an upload to another environment than the active one is not accepted
- WL+2 — A draft kept for a reload keeps only uploaded files, never their bytes, and a file without its upload's time reads expired
- WL+3 — A change-request link opens in a project only when its host and whole repository path, nested groups included, match the project's remote; another or lookalike host claims nothing
- WL+4 — A lazy panel whose code a newer build replaced reloads the app once, after a Mate's setup running in this tab, and shows the error screen instead of reloading again when the chunk still fails right after
