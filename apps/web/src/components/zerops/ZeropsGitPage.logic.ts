/**
 * What the Git page says, from what HQ has answered (SPEC §5.3): every application the person may
 * read the changes of (`read_change`), its repositories as HQ lists them and the changes open on
 * each, as HQ's stream says them (`gitOverview`).
 *
 * Held readable applications stand while other reads are pending. Pending, refused and failed
 * reads each have a visible state; a failed read stands beside whatever else was read.
 */
import {
  gitOverview,
  type FlowPullRequest,
  type GitOverviewApp,
} from "@t3tools/client-runtime/zerops";
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";

/** One application, as the page asks about it. */
export interface GitPageApp {
  readonly appId: string;
  readonly name: string;
  /** Whether HQ offers the person its changes (`useChangeOffers`); `undefined` while unsaid. */
  readonly read: boolean | undefined;
  readonly readReason?: string | undefined;
  /** The changes open on it a push reached, as HQ's stream says them; `undefined` until told. */
  readonly changes: ReadonlyArray<FlowPullRequest> | undefined;
  /** Current merged facts keep an already displayed change labeled until Update list. */
  readonly merged?: ReadonlyArray<FlowPullRequest> | undefined;
  /** Its repositories, as HQ last listed them with its releases; `undefined` until it answered. */
  readonly repositories: ReadonlyArray<{ readonly name: string }> | undefined;
  /** Why HQ's last read of its repositories did not answer, beside what it read before. */
  readonly failure: string | undefined;
}

export type GitPageState =
  | { readonly kind: "unread"; readonly failure: string | null }
  | { readonly kind: "refused"; readonly reason: string }
  | {
      readonly kind: "read";
      readonly apps: ReadonlyArray<GitOverviewApp>;
      readonly failure: string | null;
      readonly reading?: boolean;
      readonly refusals?: ReadonlyArray<{
        readonly appId: string;
        readonly name: string;
        readonly reason: string;
      }>;
    };

export function gitPageState(input: {
  /** The organization's applications are known: HQ's structure has answered. */
  readonly appsKnown: boolean;
  /** Why the structure, permission facts or changes could not be read. */
  readonly failure?: string | undefined;
  readonly apps: ReadonlyArray<GitPageApp>;
  /** A Mate's name by its project. */
  readonly mateName: (projectId: string) => string | undefined;
}): GitPageState {
  // Only the applications the page lists: why another was not read is not its to say.
  if (!input.appsKnown) return { kind: "unread", failure: input.failure ?? null };
  const refusals = input.apps.flatMap((app) =>
    app.read === false && app.readReason !== undefined
      ? [{ appId: app.appId, name: app.name, reason: app.readReason }]
      : [],
  );
  const seen = input.apps.filter((app) => app.read === true);
  const reasons = new Set([
    ...(input.failure === undefined ? [] : [input.failure]),
    ...input.apps.flatMap((app) =>
      app.read === false || app.failure === undefined ? [] : [`${app.name}: ${app.failure}`],
    ),
  ]);
  const failure = reasons.size === 0 ? null : [...reasons].join(" ");
  const waiting =
    input.apps.some((app) => app.read === undefined) ||
    seen.some(
      (app) =>
        app.failure === undefined && (app.changes === undefined || app.repositories === undefined),
    );
  const read = seen.flatMap((app) =>
    app.repositories === undefined
      ? []
      : [
          {
            appId: app.appId,
            name: app.name,
            repositories: app.repositories,
            changes: [...(app.changes ?? []), ...(app.merged ?? [])],
            coverage:
              app.changes === undefined
                ? ("unread" as const)
                : app.failure !== undefined || input.failure !== undefined
                  ? ("failed" as const)
                  : ("complete" as const),
          },
        ],
  );
  // Nothing read, and something failed: why, never an empty page.
  if (read.length === 0 && (waiting || failure !== null)) return { kind: "unread", failure };
  if (input.apps.length > 0 && seen.length === 0)
    return {
      kind: "refused",
      reason:
        refusals.length > 0
          ? [...new Set(refusals.map(({ reason }) => reason))].join(" ")
          : hqRefusalWords({ code: "forbidden", reason: "changes_not_seen" }),
    };
  return {
    kind: "read",
    apps: gitOverview({ apps: read, mateName: input.mateName }),
    failure,
    ...(waiting ? { reading: true } : {}),
    ...(refusals.length > 0 ? { refusals } : {}),
  };
}
