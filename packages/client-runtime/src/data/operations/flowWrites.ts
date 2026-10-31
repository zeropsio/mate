import { matchesNativeRelease } from "@t3tools/shared/hqRelease";
/**
 * The writes that move an application's flow, each made at the organization's official HQ as the
 * person: a release of what its offer showed, production rolled back to an earlier release, a
 * deploy asked again, a service its tier declares added, a change merged or closed. HQ answers
 * each at once; the end is HQ's records showing it — the application's releases listing the tag
 * HQ made, the stage's newer job, the change no longer open — read from the application's detail,
 * held until then, or its navigation. HQ keeps no request id for them: after a lost answer, the
 * records showing the write's effect, absent at the send, adopt it, and nothing is sent again
 * blindly. No clock ends any of them.
 *
 * @module data/operations/flowWrites
 */
import { ProjectId } from "@t3tools/contracts";
import type { ChangeLink, HqChange } from "@t3tools/shared/hqChanges";
import type { HqDeliveryAnswer, HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type {
  HqGitReleasePreflight,
  HqReleaseTarget,
  Release,
  ReleaseServicePlan,
  NativeReleaseIdentity,
} from "@t3tools/shared/hqRelease";

import {
  canonicalEnvironmentsOf,
  currentEnvironmentJobs,
  jobsByService,
} from "../../zerops/hq/environments.ts";
import { hqRefusalWords } from "../../zerops/hq/refusals.ts";
import { GIT_PREFLIGHT_PENDING } from "../../zerops/release.ts";
import type { ZeropsReleaseOffer } from "../projections/projectFlowJoin.ts";
import type { DetailDemand } from "../demand.ts";
import type { OperationReceipt } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import type { IntentOf, OperationKind, Settlement } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly release: {
      readonly orgId: string;
      readonly appId: string;
      /** The name the person chose: the next patch by default. */
      readonly tag: string;
      /** The recipe's `main` read with the offer: HQ refuses one that moved since. */
      readonly groupHead: string;
      /** What the offer listed, each production service at its commit. */
      readonly entries: ReadonlyArray<{ readonly service: string; readonly sha: string }>;
      /** Exact server-stored production plan shown before approval. */
      readonly planHash?: string;
      readonly principal?: string;
      readonly releaseTarget?: HqReleaseTarget;
      /** A branch production: the attachment the review showed and HQ's ready preflight of it. */
      readonly git?: {
        readonly releaseTarget: HqReleaseTarget;
        readonly preflight: ReadonlyArray<HqGitReleasePreflight>;
      };
    };
    readonly "roll-back": {
      readonly orgId: string;
      readonly appId: string;
      /** The earlier release production goes back to. */
      readonly tag: string;
      readonly groupHead: string;
      readonly reviewedTag?: string;
      readonly entries?: ReadonlyArray<{ readonly service: string; readonly sha: string }>;
      readonly planHash?: string;
      readonly releaseTarget?: HqReleaseTarget;
      readonly principal?: string;
    };
    readonly redeploy: {
      /** Original rendered declaration; absent on historical restored operations. */
      readonly declaration?: string;
      readonly orgId: string;
      readonly appId: string;
      /** The environment's project, and its name as HQ names it. */
      readonly projectId: string;
      readonly environment: string;
      readonly service: string;
      readonly sha: string;
      /** The service's newest job as it was asked: a newer one answers it. */
      readonly after: string;
    };
    readonly "add-service": {
      /** Original rendered declaration; absent on historical restored operations. */
      readonly declaration?: string;
      readonly orgId: string;
      readonly appId: string;
      readonly projectId: string;
      readonly environment: string;
      readonly service: string;
    };
    readonly "merge-change": {
      readonly orgId: string;
      readonly link: ChangeLink;
      /** The head the person was shown: HQ merges only that one. */
      readonly expectedHead: string;
    };
    readonly "close-change": {
      readonly orgId: string;
      readonly link: ChangeLink;
      readonly expectedHead: string | null;
    };
    readonly "hand-change": {
      readonly orgId: string;
      readonly link: ChangeLink;
      /** The application's Mate the change whose Mate is gone becomes. */
      readonly mateProjectId: string;
    };
  }
  interface OperationResults {
    /** The release HQ made, by its tag, and where its deploys stand as HQ answered. */
    readonly release: FlowAnswer;
    readonly "roll-back": FlowAnswer;
    readonly redeploy: { readonly deploys: HqDeployAnswer | undefined };
    readonly "add-service": { readonly deploys: HqDeployAnswer | undefined };
    /** The commit it squashed into main names the merge's rollout. */
    readonly "merge-change": {
      readonly deploys: HqDeployAnswer | undefined;
      readonly mergedSha: string | null;
    };
  }
}

export interface FlowAnswer {
  /** Additive Git hand-over evidence; the existing deploy answer stays Zerops-only. */
  readonly delivery?: HqDeliveryAnswer;
  readonly tag: string;
  readonly deploys: HqDeployAnswer | undefined;
}

/** An environment's write, by the project and service it asks for: its handle. */
export const environmentHandle = (intent: {
  readonly projectId: string;
  readonly service: string;
}): string => `${intent.projectId}/${intent.service}`;

/** A change's write, by its repository and number: its handle. */
export const changeHandle = (link: ChangeLink): string => `${link.repo}#${String(link.number)}`;

const detailOf = (read: ProjectionReads, appId: string, key: "releases" | "changes") => {
  const fact = read.fact("hqAppDetail", `${appId}/${key}`);
  return fact.kind === "known" ? fact.value : undefined;
};
const releasesOf = (read: ProjectionReads, appId: string): ReadonlyArray<Release> => {
  const value = detailOf(read, appId, "releases");
  return value?.kind === "releases" ? value.value : [];
};
const changeOf = (read: ProjectionReads, link: ChangeLink): HqChange | undefined => {
  const value = detailOf(read, link.appId, "changes");
  return value?.kind === "changes"
    ? value.value.find(({ repo, number }) => repo === link.repo && number === link.number)
    : undefined;
};
/** The jobs HQ's navigation lists for one of the application's environments. */
const jobsOf = (read: ProjectionReads, appId: string, projectId: ProjectId) => {
  const app = read.fact("hqApp", appId);
  if (
    app.kind !== "known" ||
    app.value.environments === undefined ||
    "refused" in app.value.environments
  )
    return undefined;
  return canonicalEnvironmentsOf(app.value.environments)?.find(
    (entry) => entry.target.kind === "zerops" && entry.target.projectId === projectId,
  );
};

/** What a release says while the recipe has nothing on `main` to tag: HQ's own words for it. */
const NO_GROUP_MAIN = hqRefusalWords({ code: "conflict", reason: "no_group_main" });

/**
 * What a release of the offer asks HQ — its entries, named `tag` (the offer's suggestion by
 * default), tagging the `groupHead` read with the offer, and for a branch production the
 * attachment and HQ's ready preflight HQ accepts it by — or why nothing is sent: what the offer's
 * gate says, that the preflight has not vouched for it yet, or that the recipe has nothing on
 * `main`, which the verbs say where they are.
 */
export function releaseRequestOf(
  offer: Pick<ZeropsReleaseOffer, "git" | "gate" | "groupHead" | "suggestion" | "entries"> &
    Partial<Pick<ZeropsReleaseOffer, "permission" | "missingServices" | "releaseTarget">>,
  tag?: string,
  plan?: ReleaseServicePlan,
):
  | Omit<IntentOf<"release">, "orgId" | "appId">
  | { readonly refused: string; readonly says: boolean } {
  if (offer.git !== undefined && offer.git.delivery?.release.allowed !== true)
    return {
      refused: offer.git.delivery?.release.reason ?? "Checking what can be released…",
      says: false,
    };
  const native = offer.git === undefined;
  if (native && offer.permission?.allowed !== true)
    return {
      refused:
        offer.permission?.allowed === false ? offer.permission.reason : "Checking who can release…",
      says: false,
    };
  if (
    native &&
    (plan === undefined ||
      offer.releaseTarget?.target.kind !== "zerops" ||
      offer.releaseTarget.declaration === undefined)
  )
    return {
      refused: "Review the exact production operations before approval.",
      says: false,
    };
  if (!native && !offer.gate.allowed) return { refused: offer.gate.reason, says: false };
  if (offer.groupHead === undefined) return { refused: NO_GROUP_MAIN, says: true };
  if (offer.git !== undefined && offer.git.preflight === undefined)
    return { refused: offer.git.check ?? GIT_PREFLIGHT_PENDING, says: false };
  return {
    kind: "release",
    tag: tag ?? offer.suggestion,
    groupHead: offer.groupHead,
    entries: offer.entries.map(({ service, commit }) => ({ service, sha: commit })),
    ...(native && plan !== undefined
      ? {
          planHash: plan.hash,
          ...(offer.releaseTarget === undefined ? {} : { releaseTarget: offer.releaseTarget }),
        }
      : {}),
    ...(offer.git?.preflight === undefined
      ? {}
      : { git: { releaseTarget: offer.git.attachment, preflight: offer.git.preflight } }),
  };
}

const appDetail = (appId: string): DetailDemand => ({ family: "hqAppDetail", ownerId: appId });

export function nativeReleaseIdentityOf(
  intent: FlowWriteIntent,
): NativeReleaseIdentity | undefined {
  if (intent.kind !== "release" && intent.kind !== "roll-back") return undefined;
  if (intent.kind === "release" && intent.git !== undefined) return undefined;
  if (
    intent.planHash === undefined ||
    intent.releaseTarget === undefined ||
    intent.principal === undefined
  )
    return undefined;
  const tag = intent.kind === "release" ? intent.tag : intent.reviewedTag;
  if (tag === undefined || intent.entries === undefined) return undefined;
  return {
    tag,
    groupHead: intent.groupHead,
    entries: intent.entries.map((entry) => ({ ...entry })),
    planHash: intent.planHash,
    releaseTarget: { ...intent.releaseTarget, target: { ...intent.releaseTarget.target } },
    principal: intent.principal,
    ...(intent.kind === "roll-back" ? { rollbackOf: intent.tag } : {}),
  };
}
function exactNativeRelease(
  record: Release,
  intent: IntentOf<"release"> | IntentOf<"roll-back">,
): boolean {
  if (intent.kind === "release" && intent.git !== undefined) return record.tag === intent.tag;
  const original = nativeReleaseIdentityOf(intent);
  return original !== undefined && matchesNativeRelease(record, original);
}

/** A release HQ lists under the receipt's tag: its end, approved or refused in HQ's words. */
function releaseListed(
  read: ProjectionReads,
  appId: string,
  receipt: OperationReceipt,
  intent: IntentOf<"release"> | IntentOf<"roll-back">,
): Settlement | null {
  const listed = releasesOf(read, appId).find(
    (record) => record.tag === receipt.operationId && exactNativeRelease(record, intent),
  );
  if (listed === undefined) return null;
  return listed.state === "approved"
    ? { kind: "succeeded" }
    : { kind: "failed", reason: listed.reason ?? "HQ refused this release." };
}

export const releaseWrite: OperationKind<"release"> = {
  kind: "release",
  executor: "hq",
  reflected: (read, intent, receipt) => releaseListed(read, intent.appId, receipt, intent) !== null,
  settledBy: (read, intent, receipt) => releaseListed(read, intent.appId, receipt, intent),
  observedIn: (intent) => appDetail(intent.appId),
  // After a lost answer: the release under the very name it asked for.
  effectHandles: (read, intent) =>
    releasesOf(read, intent.appId).flatMap((record) =>
      record.tag === intent.tag && exactNativeRelease(record, intent) ? [record.tag] : [],
    ),
};

export const rollBackWrite: OperationKind<"roll-back"> = {
  kind: "roll-back",
  executor: "hq",
  reflected: (read, intent, receipt) => releaseListed(read, intent.appId, receipt, intent) !== null,
  settledBy: (read, intent, receipt) => releaseListed(read, intent.appId, receipt, intent),
  observedIn: (intent) => appDetail(intent.appId),
  // After a lost answer: only the original reviewed new tag and its copied plan.
  effectHandles: (read, intent) =>
    releasesOf(read, intent.appId).flatMap((record) =>
      exactNativeRelease(record, intent) ? [record.tag] : [],
    ),
};

/** Whether the service's newest job is newer than the one it was asked again over. */
const askedAgain = (read: ProjectionReads, intent: IntentOf<"redeploy">) => {
  const environment = jobsOf(read, intent.appId, ProjectId.make(intent.projectId));
  if (intent.declaration === undefined || environment?.declaration !== intent.declaration)
    return false;
  const latest = jobsByService(environment).get(intent.service)?.latest;
  return latest !== undefined && latest.id !== intent.after && latest.sha === intent.sha;
};

export const redeployWrite: OperationKind<"redeploy"> = {
  kind: "redeploy",
  executor: "hq",
  reflected: (read, intent) => askedAgain(read, intent),
  settledBy: (read, intent) => (askedAgain(read, intent) ? { kind: "succeeded" } : null),
  effectHandles: (read, intent) => (askedAgain(read, intent) ? [environmentHandle(intent)] : []),
};

/** Whether HQ's navigation lists a job adding the service to the environment. */
const added = (read: ProjectionReads, intent: IntentOf<"add-service">) => {
  const environment = jobsOf(read, intent.appId, ProjectId.make(intent.projectId));
  return (
    intent.declaration !== undefined &&
    environment?.declaration === intent.declaration &&
    currentEnvironmentJobs(environment).some(
      ({ cause, service }) => cause === "add_service" && service === intent.service,
    )
  );
};

export const addServiceWrite: OperationKind<"add-service"> = {
  kind: "add-service",
  executor: "hq",
  reflected: (read, intent) => added(read, intent),
  settledBy: (read, intent) => (added(read, intent) ? { kind: "succeeded" } : null),
  effectHandles: (read, intent) => (added(read, intent) ? [environmentHandle(intent)] : []),
};

export const mergeChangeWrite: OperationKind<"merge-change"> = {
  kind: "merge-change",
  executor: "hq",
  reflected: (read, intent) => (changeOf(read, intent.link)?.state ?? "open") !== "open",
  settledBy: (read, intent) => {
    const state = changeOf(read, intent.link)?.state ?? "open";
    if (state === "open") return null;
    return state === "merged"
      ? { kind: "succeeded" }
      : { kind: "failed", reason: "The change was closed without merging." };
  },
  observedIn: (intent) => appDetail(intent.link.appId),
  effectHandles: (read, intent) =>
    changeOf(read, intent.link)?.state === "merged" ? [changeHandle(intent.link)] : [],
};

export const closeChangeWrite: OperationKind<"close-change"> = {
  kind: "close-change",
  executor: "hq",
  reflected: (read, intent) => (changeOf(read, intent.link)?.state ?? "open") !== "open",
  settledBy: (read, intent) => {
    const state = changeOf(read, intent.link)?.state ?? "open";
    if (state === "open") return null;
    return state === "closed"
      ? { kind: "succeeded" }
      : { kind: "failed", reason: "The change was merged instead of closed." };
  },
  observedIn: (intent) => appDetail(intent.link.appId),
  effectHandles: (read, intent) =>
    changeOf(read, intent.link)?.state === "closed" ? [changeHandle(intent.link)] : [],
};

/** Whether HQ's detail holds the change as the Mate's it was handed to. */
const handed = (read: ProjectionReads, intent: IntentOf<"hand-change">) =>
  changeOf(read, intent.link)?.mateProjectId === intent.mateProjectId;

export const handChangeWrite: OperationKind<"hand-change"> = {
  kind: "hand-change",
  executor: "hq",
  reflected: (read, intent) => handed(read, intent),
  settledBy: (read, intent) => {
    if (handed(read, intent)) return { kind: "succeeded" };
    return (changeOf(read, intent.link)?.state ?? "open") === "open"
      ? null
      : { kind: "failed", reason: "The change is merged or closed already." };
  },
  observedIn: (intent) => appDetail(intent.link.appId),
  effectHandles: (read, intent) => (handed(read, intent) ? [changeHandle(intent.link)] : []),
};

export const FLOW_WRITE_KINDS = [
  releaseWrite,
  rollBackWrite,
  redeployWrite,
  addServiceWrite,
  mergeChangeWrite,
  closeChangeWrite,
  handChangeWrite,
] as const;

/** A flow write's intent, whichever it is. */
export type FlowWriteIntent = IntentOf<(typeof FLOW_WRITE_KINDS)[number]["kind"]>;
