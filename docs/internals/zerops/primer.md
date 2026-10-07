# Mate and HQ — domain terms

- A **Mate** is a coding environment in a Zerops project: its code, coding agents and durable work.
- A **Zerops project** groups services on the platform. It is distinct from an application.
- **HQ** is an organization's authority for applications, repositories, changes and deployments.
  **Core** is the service that carries that authority.
- An **application** groups related repositories and environments in HQ.
- An **environment** is a place an application's code runs. A Mate is for development, **stage**
  follows merged work, and **production** runs a release. A Mate's **preview** is its development
  code running in the stage half of a dev/stage pair.
- A **repository** is one codebase's durable history.
- A **recipe** describes how an application is built and run in its environments.
- A **change** is proposed repository work awaiting merge or closure.
- A **release** names a fixed selection of application code and configuration for production.
  A **rollback** is a release selecting earlier work.
- A **login** is a coding agent's account access; its **signer** is the person who signed in with it.
- A **crew** is a Mate's standing group of coding agents. A **crewmate** is one member.
- A **writer** builds in its own **copy** of the code; a **reader** reviews without writing;
  a **lead** plans and reviews the crew's work without writing.
- A **goal** is the crew's shared intent. A **job** is a crewmate's continuing purpose. A **task**
  is a piece of work assigned to a crewmate.
- A **stint** is one session of a crewmate's conversation.

The shared runtime terms — project, thread, turn and provider — live in the
[internal glossary](../glossary.md). User-facing words live in the [design guide](design-system.md).
