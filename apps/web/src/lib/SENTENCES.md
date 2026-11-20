next: WL6

- WL1 — A terminal context whose captured text is gone, nothing but line breaks left, is not sent; one that still holds text is sent, in its order
- WL2 — A message waits while any of its attachments is missing, uploading or failed, and an upload to another environment than the active one is not accepted
- WL3 — A draft kept for a reload keeps only uploaded files, never their bytes, and a file without its upload's time reads expired
- WL4 — A change-request link opens in a project only when its host and whole repository path, nested groups included, match the project's remote; another or lookalike host claims nothing
- WL5 — A lazy panel whose code a newer build replaced reloads the app once, after a Mate's setup running in this tab, and shows the error screen instead of reloading again when the chunk still fails right after
