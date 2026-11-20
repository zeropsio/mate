import * as Schema from "effect/Schema";

/** Follows git's own clone phases as they appear on stderr, in order. */
export const ProjectCloneStage = Schema.Literals([
  "connecting",
  "counting",
  "receiving",
  "resolving",
  "checkout",
]);
export type ProjectCloneStage = typeof ProjectCloneStage.Type;
