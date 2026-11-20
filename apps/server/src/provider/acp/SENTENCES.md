next: AP16

- AP1 — A provider's stderr excerpt shown on an error replaces the home directory with `~` and hides pairing links, bearer, basic and x-api-key credentials and secret keys, hyphenated project, service and Anthropic keys included
- AP2 — Cursor starts with `--force` only under full access and with `--auto-review` only under auto; supervised and auto-accept-edits start it with neither
- AP3 — Cursor's model selection sets the base model id, without its bracketed parameters, before any option, then each chosen option under Cursor's own option id and value
- AP4 — Grok starts in its ask mode under supervised, accept-edits under auto-accept-edits, auto under auto and always-approve only under full access, the mode on the argv so a config file cannot override it, and with no mode it inherits its own config
- AP5 — A Grok model selection switches the session's model only when another model is asked for, and never sends the product slug `grok-build`, which keeps the session's current model
- AP6 — A Grok selection carries a reasoning effort only when one was asked for and is a valid token, and a selection that omits the effort never clears the current one
- AP7 — An ACP permission request for a command opens and resolves as a command approval, one for an edit as a file-change approval, and one of any other kind, a future kind included, as a generic tool approval
- AP8 — An ACP approval offers exactly the choices the provider sent, without a remembered-allow added, and a request that sent none carries no choices
- AP9 — An Antigravity approval answers only with an option the agent offered, allow-once for accept, allow-always for this thread or always, reject-once for decline and nothing for cancel, and nothing at all when the matching kind is missing
- AP10 — Antigravity offers a person only the decisions the request can honor, then Cancel, and shows the agent's prompt-injection warning text on the remembered approval
- AP11 — A native Antigravity question reaches the person as a single-choice question, never as an approval, and the answer goes back as the chosen option's exact id, a reject-labelled choice included, or by its label only when exactly one option bears it
- AP12 — An unusable answer to a native question (empty, free text, several choices, another shape) or a question with a missing or duplicate option id sends nothing and keeps the question open
- AP13 — A captured Antigravity command shows its command line, working directory, output and exit code under every native field name, and a nonzero exit stays a completed command, not a tool failure
- AP14 — Antigravity tool output reaching the conversation stays bounded and keeps its end, and no inline image bytes, image blob or image data URL reaches it, while the rest of the tool's content stays
- AP15 — Only a local image path (a workspace path, a Windows path or a local file URL) becomes a tool's image, never a web address, another host's file URL or a data URL
