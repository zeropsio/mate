# Observe stage and production

Ask your agent to check your project's stage or production. It uses `zerops_observe` to list the
available environments, read service status and the active version, or fetch recent service logs.
The tool reads through Headquarters; your Mate's Zerops key still reaches only its own project.

An environment is available only when every person who can operate the Mate can read that
Zerops project. Headquarters must hold a working deploy key for it. It returns runtime facts and
logs, never project variables or credentials. Log reads return at most 100 entries, each limited
to 4,096 characters.

If Headquarters, Zerops or the log backend cannot answer, the tool reports the failure. After
fixing the problem, ask the agent to check again; the call does not retry automatically.
