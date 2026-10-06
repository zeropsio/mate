/**
 * Updating an organization's HQ to the Core this build of the app carries (`hq-core/`).
 *
 * - **Which Core:** `<commit UTC>.<digest>` (`apps/hq/src/coreIdentity.ts`): HQ's `/health`
 *   `build`, the web's `hq-core/build.json`, and the app version a birth or an update names
 *   `hq-core.<identity>`. One digest is one Core whatever the commit; the commit time only orders
 *   two different ones, so an older tab never offers its Core as an update. A stamp of the old
 *   scheme (`<sha>.<build UTC>`) reads as older: its first update moves it onto this one.
 * - **Where it stands:** the Core HQ's health answers with, and Zerops' newest build of its `hq`
 *   service — never a flag of this browser's. The service list embeds the active app version
 *   without its name (KRLS, 2026-10-04), so Zerops names the running Core only through the build
 *   that deployed it, while the project's newest processes still hold it.
 */
import type { ActivityProcess } from "../activity/dto.ts";
import type { ZeropsService } from "../api.ts";
import { HQ_CORE_VERSION_PREFIX } from "./birth.ts";

/** `<commit UTC>.<first 12 hex of the digest>`. */
const IDENTITY = /^(\d{8}T\d{6}Z)\.([0-9a-f]{12})$/u;

interface CoreIdentity {
  readonly committedAt: string;
  readonly digest: string;
}

function parseCoreIdentity(build: string): CoreIdentity | undefined {
  const match = IDENTITY.exec(build);
  return match === null ? undefined : { committedAt: match[1]!, digest: match[2]! };
}

/**
 * Whether an HQ running `running` is offered the Core `carried`: never a Core of the same
 * digest, never one older by its commit, always where `running` reads in no known identity.
 */
export function hqUpdateOffered(running: string, carried: string): boolean {
  const offer = parseCoreIdentity(carried);
  if (offer === undefined) return false;
  const runs = parseCoreIdentity(running);
  if (runs === undefined) return true;
  return runs.digest !== offer.digest && offer.committedAt > runs.committedAt;
}

/** The Core an app version's name says: its identity, or the name itself where it says none. */
function namedCore(name: string | null | undefined): string {
  if (name == null) return "";
  return name.startsWith(HQ_CORE_VERSION_PREFIX) ? name.slice(HQ_CORE_VERSION_PREFIX.length) : name;
}

/** A process that builds or deploys a service's code. */
const DEPLOY_ACTIONS: ReadonlySet<string> = new Set(["stack.build", "stack.deploy"]);
const LIVE_STATUSES: ReadonlySet<string> = new Set(["PENDING", "RUNNING"]);
const FAILED_STATUSES: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);

/** Where HQ's Core stands against the one this app carries, as Zerops says it. */
export type HqUpdateState =
  /** Nothing to offer: HQ runs this Core, or one at least as new. */
  | { readonly kind: "current"; readonly running: string }
  | { readonly kind: "available"; readonly running: string; readonly carried: string }
  /** A build or deploy of HQ's service is under way; `target` the Core it deploys, if named. */
  | { readonly kind: "updating"; readonly target: string | undefined }
  /** HQ's newest build failed; it still runs `running`. */
  | {
      readonly kind: "failed";
      readonly running: string;
      readonly carried: string;
      readonly reason: string;
    };

export function hqUpdateState(input: {
  /** HQ's `hq` service. */
  readonly service: Pick<ZeropsService, "id" | "activeAppVersion">;
  /** Its project's newest processes. */
  readonly processes: ReadonlyArray<ActivityProcess>;
  /** The Core this app carries. */
  readonly carried: string;
  /** The Core HQ's health names; `undefined` while it does not answer. */
  readonly answering: string | undefined;
}): HqUpdateState {
  const { carried } = input;
  const deploys = input.processes
    .filter(
      (process) =>
        DEPLOY_ACTIONS.has(process.actionName) &&
        process.serviceStackIds.includes(input.service.id),
    )
    .sort((left, right) => Date.parse(right.created) - Date.parse(left.created));
  const newest = deploys[0];
  const activeId = input.service.activeAppVersion?.id;
  // No id names no build: an active version without one matches none, never one without one.
  const answered =
    input.answering ??
    namedCore(
      activeId === undefined
        ? undefined
        : deploys.find((process) => process.appVersion?.id === activeId)?.appVersion?.name,
    );
  // A deploy of a newer Core that FINISHED runs it, though HQ may answer with the one before it
  // for a few seconds (KRLS, 2026-10-04).
  const deployed = newest?.status === "FINISHED" ? namedCore(newest.appVersion?.name) : "";
  const running = hqUpdateOffered(answered, deployed) ? deployed : answered;
  if (newest !== undefined && LIVE_STATUSES.has(newest.status)) {
    const target = namedCore(newest.appVersion?.name);
    // HQ may answer with the new Core before Zerops ends its build (KRLS, 2026-10-04).
    if (target === "" || hqUpdateOffered(running, target)) {
      return { kind: "updating", target: target === "" ? undefined : target };
    }
  }
  if (!hqUpdateOffered(running, carried)) return { kind: "current", running };
  if (newest !== undefined && FAILED_STATUSES.has(newest.status)) {
    return {
      kind: "failed",
      running,
      carried,
      reason: newest.failReason ?? "Zerops did not say why.",
    };
  }
  return { kind: "available", running, carried };
}
