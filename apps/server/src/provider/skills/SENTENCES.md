next: SK10

- SK1 — A `$name` mention that names no discovered skill, or is glued to the text before it, stays prose and dispatches nothing
- SK2 — The last mention of a known skill becomes the trailing slash command with the rest of the prompt as its arguments, earlier mentions become `/name` inline in the whole prompt that leads it, and a mention that opens the prompt sends one command block alone
- SK3 — Any currency sign opens a mention as `$` does and a skill name may begin with a digit, while an amount after any currency sign (20, 20k, 100M, 1e6) is never a mention, even where a skill bears that name
- SK4 — The skills offered for Claude are the user's `<config dir>/skills` and the project's `.claude/skills`, never `.agents/skills`, and on a name collision the user's skill is the one offered
- SK5 — A skill is named and switched off by its directory, never its frontmatter name; one without frontmatter keeps its directory name with no description, and one whose frontmatter does not parse is not offered
- SK6 — A skill a settings file switches off is offered disabled, `user-invocable-only` keeps it on for the person alone, a settings file that does not parse is ignored, and one invalid value drops every override of its file
- SK7 — Overrides are read from the user's settings, the workspace's settings and local settings, the repository root's local settings after them, and the administrator's managed policy last, which outranks every other; no ancestor outside a repository is read
- SK8 — User skills are read from the instance's home path when one is set, else from `CLAUDE_CONFIG_DIR` resolved against the workspace, and a missing home or workspace offers no skill
- SK9 — A skill whose frontmatter disables model invocation, in any YAML 1.1 true spelling, is marked for the person alone, and one marked not user-invocable, in any false spelling, is kept out of the person's slash commands
