import * as Schema from "effect/Schema";

const GitHubEvent = Schema.Struct({
  before: Schema.optional(Schema.String),
  ref: Schema.optional(Schema.String),
  pull_request: Schema.optional(Schema.Struct({ base: Schema.Struct({ sha: Schema.String }) })),
});
export const decodeGitHubEvent = Schema.decodeUnknownSync(Schema.fromJsonString(GitHubEvent));

/**
 * What a GitHub run's ratchet compares with: a pull request's base, a push's previous head. A
 * new branch, tag or event without a previous SHA compares with `base`, main.
 */
export const githubRatchetRevision = (event: typeof GitHubEvent.Type, base: string): string => {
  const revision = event.pull_request?.base.sha ?? event.before;
  if (revision !== undefined && /^[a-f0-9]{40}$/u.test(revision) && !/^0+$/u.test(revision))
    return revision;
  return base;
};
