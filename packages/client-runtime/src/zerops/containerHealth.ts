/** What a `/healthz` probe concluded about a container. */
export type ZeropsContainerHealth =
  | "ready"
  | "initializing"
  | "predates-mate"
  | "unreachable"
  /** The container is up but Mate never answered. */
  | "stalled";
