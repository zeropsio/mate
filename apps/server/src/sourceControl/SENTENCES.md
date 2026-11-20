next: SC8

- SC1 — A Bitbucket request answered with a redirect to another host fails as untrusted and is not followed, so the account's token never reaches that host
- SC2 — A GitLab merge request is created through `glab api` with its description read from the body file, so the body never stands in the process arguments
- SC3 — A pull-request template committed as a symlink is never read; the committed regular template is used instead
- SC4 — Two Forgejo logins on one SSH host with different server ports give a remote no default login unless the requested host names the port
- SC5 — A value carried in a source-control error loses a URL's credentials, query and fragment
- SC6 — A provider resolved for a remote the caller selected keeps that remote and only refines its provider kind, never switching to another configured remote
- SC7 — The remote URL a prepared clone reports carries no embedded credentials, while Git still receives the URL that has them
