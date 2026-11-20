next: RI9

- RI1 — A folder with both an `upstream` and an `origin` remote is identified by `upstream`, and a fork's own `origin` is reported beside it
- RI2 — A remote's identity is its host and lower-cased path, its owner the first path segment and its name the last, nested groups included
- RI3 — A folder's repository root is Git's top level, read once and read again only when a refresh is asked
- RI4 — A folder found outside a repository, or whose root lookup failed, is asked again on the next resolve, so a fresh `git init` shows at once
- RI5 — A remote lookup that failed is not kept: the next resolve asks Git again
- RI6 — A repository without a remote stays without an identity until its negative lifetime passes, and then a remote added meanwhile shows
- RI7 — A found identity is kept for its positive lifetime, and a changed remote shows once it passes
- RI8 — A provider refinement of an identity runs once per kept identity, and when it fails the plain identity is kept
