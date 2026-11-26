import type { ExchangeFailure } from "../../zerops/environments/environmentMachine.ts";
import type { HqApi, WebFailureKind } from "../../zerops/hq/client.ts";

export type { WebFailureKind } from "../../zerops/hq/client.ts";

/** Only failures that leave the Mate unopened are reported; refusals have their own words. */
export function webFailureKindOf(failure: ExchangeFailure): WebFailureKind | null {
  if (failure.class !== "retryable") return null;
  const kind = failure.cause.kind;
  return kind === "descriptor-unreachable" || kind === "identity-failed" ? kind : null;
}

/** One report per organisation, project and kind until that project's exchange succeeds. */
export function webFailureReporter(hqOf: (orgId: string) => Pick<HqApi, "webFailure"> | null) {
  const reported = new Map<string, Set<WebFailureKind>>();
  const keyOf = (mate: { readonly orgId: string; readonly projectId: string }) =>
    JSON.stringify([mate.orgId, mate.projectId]);

  return {
    failed(
      mate: { readonly orgId: string; readonly projectId: string },
      kind: WebFailureKind,
    ): void {
      try {
        const hq = hqOf(mate.orgId);
        if (hq === null) return;
        const key = keyOf(mate);
        const kinds = reported.get(key) ?? new Set<WebFailureKind>();
        if (kinds.has(kind)) return;
        kinds.add(kind);
        reported.set(key, kinds);
        void hq.webFailure({ projectId: mate.projectId, kind }).catch(() => {});
      } catch {
        // Reporting is evidence only and cannot affect opening a Mate.
      }
    },
    opened(mate: { readonly orgId: string; readonly projectId: string }): void {
      reported.delete(keyOf(mate));
    },
  };
}
