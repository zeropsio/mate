# Shared runtime terms

- **Project**: An environment-local workspace record rooted at a directory.
- **Workspace root**: A project’s root filesystem path.
- **Worktree**: An isolated Git working tree.
- **Thread**: A durable conversation and workspace history within a project.
- **Turn**: One user-to-agent work cycle within a thread.
- **Activity**: A non-message item in a thread’s history.
- **Orchestration**: The domain that turns commands and runtime evidence into durable state.
- **Aggregate**: The domain object to which a command or event belongs.
- **Command**: A typed request to change domain state.
- **Domain event**: A persisted fact that something happened.
- **Decider**: Pure logic that derives events from a command and current state.
- **Projection**: A read view derived from authoritative facts.
- **Projector**: Logic that applies events to a read view.
- **Read model**: A materialized view of domain state.
- **Reactor**: A service that performs side effects in response to domain evidence.
- **Receipt**: A typed record of an operation’s outcome or an async milestone.
- **Quiesced**: All relevant follow-up work has settled.
- **Provider**: The agent runtime that performs work.
- **Session**: A live provider runtime attached to a thread.
- **Runtime mode**: The safety and access policy for a session.
- **Interaction mode**: The agent’s style of interaction.
- **Assistant delivery mode**: The policy for delivering assistant text to a conversation.
- **Snapshot**: A point-in-time view of state.
- **Model manifest**: Provider-owned model catalogue metadata.
- **Checkpoint**: A saved workspace state.
- **Checkpoint ref**: The durable identifier of a checkpoint.
- **Checkpoint baseline**: The starting checkpoint for a comparison.
- **Checkpoint diff**: The difference between checkpoints.
- **Turn diff**: The workspace changes attributed to one turn.

Application and platform terms live in the [domain glossary](zerops/primer.md).
