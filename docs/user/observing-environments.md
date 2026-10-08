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

A Mate can answer while its container is short on resources. Its conversation shows measured
memory, disk or CPU strain with its name and an action. Memory warnings include the container's
enforced cap: close idle terminal agents or an IDE in the container, or raise RAM in Zerops. If
Zerops's configured minimum exceeds the live cap, Mate says the increase has not reached the
container. After a lost connection, HQ's retained report is labelled **last-known health** with its
measurement time; it does not claim the container is still in that condition.

CPU warnings compare recent CPU use and runnable work waiting for CPU with the container's
enforced CPU limit. They show the measurement window and the busiest measured process when it
can be identified. A past spike alone does not trigger a warning; the first quiet measurement
clears it. CPU measurements refresh every two seconds, including while the conversation is idle.
