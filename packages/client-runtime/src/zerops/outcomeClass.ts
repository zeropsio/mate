// The classes an answer of a remote source falls into, as values: adapters classify into them, the
// data layer's stream machine decides retry, backoff and refusal from them.

/** Every answer a source gives falls into one of these classes. */
export type OutcomeClass =
  | "definitive-refusal"
  | "recoverable-session"
  | "transient"
  | "access-unverified"
  | "authoritative-denial"
  | "proven-deletion"
  | "corrupt-data"
  | "uncertain-acceptance"
  | "observation-exhausted";

/**
 * The classes a stream's lifecycle answers. The rest belong to a fact (deletion, corrupt row) or
 * to an operation (uncertain acceptance, exhausted observation) and never move a stream.
 */
export type StreamOutcome = Extract<
  OutcomeClass,
  | "definitive-refusal"
  | "recoverable-session"
  | "transient"
  | "access-unverified"
  | "authoritative-denial"
>;
