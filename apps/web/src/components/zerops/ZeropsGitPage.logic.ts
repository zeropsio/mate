/**
 * What the Git page says, from what HQ has answered (SPEC §5.3): every application the person may
 * read the changes of (`read_change`), its repositories as HQ lists them and the changes open on
 * each, as HQ's stream says them (`gitOverview`).
 *
 * Unread is not empty: until every such application has its repositories and its changes known,
 * the page says nothing — or why a read did not answer — rather than a list that would grow under
 * the person. A read that failed is named beside whatever else was read.
 */
import {
  gitOverview,
  type FlowPullRequest,
  type GitOverviewApp,
} from "@t3tools/client-runtime/zerops";

/** One application, as the page asks about it. */
export interface GitPageApp {
  readonly appId: string;
  readonly name: string;
  /** Whether HQ's rule offers the person its changes (`useChangeOffers`); `undefined` while not asked. */
  readonly read: boolean | undefined;
  /** The changes open on it a push reached, as HQ's stream says them; `undefined` until told. */
  readonly changes: ReadonlyArray<FlowPullRequest> | undefined;
}

export type GitPageState =
  | { readonly kind: "unread"; readonly failure: string | null }
  | {
      readonly kind: "read";
      readonly apps: ReadonlyArray<GitOverviewApp>;
      readonly failure: string | null;
    };

export function gitPageState(input: {
  /** The organization's applications are known: HQ's structure has answered. */
  readonly appsKnown: boolean;
  readonly apps: ReadonlyArray<GitPageApp>;
  /** Each application's repositories, as HQ last listed them. */
  readonly repos: ReadonlyMap<string, ReadonlyArray<{ readonly name: string }>>;
  /** Why an application's repositories did not answer, by application. */
  readonly failures: ReadonlyMap<string, string>;
  /** A Mate's name by its project. */
  readonly mateName: (projectId: string) => string | undefined;
}): GitPageState {
  const reasons = new Set(input.failures.values());
  const failure = reasons.size === 0 ? null : [...reasons].join(" ");
  if (!input.appsKnown || input.apps.some((app) => app.read === undefined)) {
    return { kind: "unread", failure };
  }
  const seen = input.apps.filter((app) => app.read === true);
  const waiting = seen.some(
    (app) =>
      app.changes === undefined || (!input.repos.has(app.appId) && !input.failures.has(app.appId)),
  );
  const read = seen.flatMap((app) => {
    const repositories = input.repos.get(app.appId);
    return repositories === undefined || app.changes === undefined
      ? []
      : [{ appId: app.appId, name: app.name, repositories, changes: app.changes }];
  });
  // Nothing read, and something failed: why, never an empty page.
  if (waiting || (read.length === 0 && failure !== null)) return { kind: "unread", failure };
  return { kind: "read", apps: gitOverview({ apps: read, mateName: input.mateName }), failure };
}
