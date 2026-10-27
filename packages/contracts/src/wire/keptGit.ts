/** The question whether to keep a removed project's Git, and its answer (`spec/protocol.md`, S25). */
import * as Schema from "effect/Schema";

/** An Owner's or Admin's answer: keep the application's Git, or delete the application with it. */
export const KeptGitAnswer = Schema.Struct({ answer: Schema.Literals(["keep", "delete"]) });
export type KeptGitAnswer = typeof KeptGitAnswer.Type;

/** Navigation's `keptGit:<appId>` value: one open question about one application. */
export const KeptGitQuestion = Schema.Struct({
  appId: Schema.String,
  appName: Schema.String,
  projectId: Schema.String,
  projectName: Schema.NullOr(Schema.String),
  askedAt: Schema.String,
});
export type KeptGitQuestion = typeof KeptGitQuestion.Type;
