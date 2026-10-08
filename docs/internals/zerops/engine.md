# Conversation engine terms and rules

The engine owns a Mate's conversation record and work. Product-wide meanings of Mate, crew and
login live in the [primer](primer.md); runtime vocabulary lives in the [glossary](../glossary.md).

## Terms

- A **conversation** is an agent's durable record, including messages waiting to run.
- A **session** is that agent's context inside one provider. A conversation can span sessions.
- A **run** is one unit of work, with a trigger, a principal and an evidence-backed outcome.
  A continuation can join an earlier run. Unresponsiveness is a mark, not an outcome.
- An **item** is a typed entry in the conversation record.
- A **request** is an approval, question or other answer owed by a person.
- An **effect** is recorded work outside the pure engine: a send, interruption, session change,
  workspace capture or crew step.
- A **wake** is scheduled work with an owner and an admission guard.

## Rules

One writer orders each conversation's inputs. Independent conversations must not wait on one
another's provider. Commit receipts, events, projections and queued effects together. Record an
outside action before executing it; reconcile uncertain work by its identity rather than blindly
repeating it.

Every run names its principal. Server sequences order the record; client clocks are for display.
Only evidence ends work. A timer may schedule observation or mark unresponsiveness, but cannot
settle an outcome. Store the context given to the agent without storing vault secrets.

The provider bridge translates runtime evidence into engine terms. Missing provider evidence
stays unknown. New wire members require forward-compatible readers and an explicit protocol
compatibility boundary.
