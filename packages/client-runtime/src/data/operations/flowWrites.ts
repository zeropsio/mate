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
import type { ChangeLink, HqChange } from "@t3tools/shared/hqChanges";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type { Release } from "@t3tools/shared/hqRelease";

import { environmentsOf, jobsByService } from "../../zerops/hq/environments.ts";
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
    };
    readonly "roll-back": {
      readonly orgId: string;
      readonly appId: string;
      /** The earlier release production goes back to. */
      readonly tag: string;
      readonly groupHead: string;
    };
    readonly redeploy: {
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
    };
  }
  interface OperationResults {
    /** The release HQ made, by its tag, and where its deploys stand as HQ answered. */
    readonly release: FlowAnswer;
    readonly "roll-back": FlowAnswer;
    readonly redeploy: { readonly deploys: HqDeployAnswer | undefined };
    readonly "add-service": { readonly deploys: HqDeployAnswer | undefined };
    readonly "merge-change": { readonly deploys: HqDeployAnswer | undefined };
  }
}

export interface FlowAnswer {
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
const jobsOf = (read: ProjectionReads, appId: string, projectId: string) => {
  const app = read.fact("hqApp", appId);
  if (app.kind !== "known" || "refused" in app.value.environments) return undefined;
  return environmentsOf(app.value.environments)?.find((entry) => entry.projectId === projectId);
};

const appDetail = (appId: string): DetailDemand => ({ family: "hqAppDetail", ownerId: appId });

/** A release HQ lists under the receipt's tag: its end, approved or refused in HQ's words. */
function releaseListed(
  read: ProjectionReads,
  appId: string,
  receipt: OperationReceipt,
): Settlement | null {
  const listed = releasesOf(read, appId).find(({ tag }) => tag === receipt.operationId);
  if (listed === undefined) return null;
  return listed.state === "approved"
    ? { kind: "succeeded" }
    : { kind: "failed", reason: listed.reason ?? "HQ refused this release." };
}

export const releaseWrite: OperationKind<"release"> = {
  kind: "release",
  executor: "hq",
  reflected: (read, intent, receipt) => releaseListed(read, intent.appId, receipt) !== null,
  settledBy: (read, intent, receipt) => releaseListed(read, intent.appId, receipt),
  observedIn: (intent) => appDetail(intent.appId),
  // After a lost answer: the release under the very name it asked for.
  effectHandles: (read, intent) =>
    releasesOf(read, intent.appId).flatMap(({ tag }) => (tag === intent.tag ? [tag] : [])),
};

export const rollBackWrite: OperationKind<"roll-back"> = {
  kind: "roll-back",
  executor: "hq",
  reflected: (read, intent, receipt) => releaseListed(read, intent.appId, receipt) !== null,
  settledBy: (read, intent, receipt) => releaseListed(read, intent.appId, receipt),
  observedIn: (intent) => appDetail(intent.appId),
  // After a lost answer: a new release listing the earlier one's entries, named by HQ.
  effectHandles: (read, intent) =>
    releasesOf(read, intent.appId).flatMap(({ tag, rollbackOf }) =>
      rollbackOf === intent.tag ? [tag] : [],
    ),
};

/** Whether the service's newest job is newer than the one it was asked again over. */
const askedAgain = (read: ProjectionReads, intent: IntentOf<"redeploy">) => {
  const environment = jobsOf(read, intent.appId, intent.projectId);
  const latest =
    environment === undefined ? undefined : jobsByService(environment).get(intent.service)?.latest;
  return latest !== undefined && latest.id !== intent.after;
};

export const redeployWrite: OperationKind<"redeploy"> = {
  kind: "redeploy",
  executor: "hq",
  reflected: (read, intent) => askedAgain(read, intent),
  settledBy: (read, intent) => (askedAgain(read, intent) ? { kind: "succeeded" } : null),
  effectHandles: (read, intent) => (askedAgain(read, intent) ? [environmentHandle(intent)] : []),
};

/** Whether HQ's navigation lists a job adding the service to the environment. */
const added = (read: ProjectionReads, intent: IntentOf<"add-service">) =>
  jobsOf(read, intent.appId, intent.projectId)?.jobs.some(
    ({ cause, service }) => cause === "add_service" && service === intent.service,
  ) ?? false;

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
  settledBy: (read, intent) =>
    (changeOf(read, intent.link)?.state ?? "open") === "open" ? null : { kind: "succeeded" },
  observedIn: (intent) => appDetail(intent.link.appId),
  effectHandles: (read, intent) =>
    changeOf(read, intent.link)?.state === "closed" ? [changeHandle(intent.link)] : [],
};

export const FLOW_WRITE_KINDS = [
  releaseWrite,
  rollBackWrite,
  redeployWrite,
  addServiceWrite,
  mergeChangeWrite,
  closeChangeWrite,
] as const;

/** A flow write's intent, whichever it is. */
export type FlowWriteIntent = IntentOf<(typeof FLOW_WRITE_KINDS)[number]["kind"]>;
