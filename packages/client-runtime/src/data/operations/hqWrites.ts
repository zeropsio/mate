/**
 * The writes a creation makes at HQ, which HQ executes and answers at once: an application, a
 * Mate's birth intent and its bind to a project, a project attached to an application, a Mate's
 * record in none and its close-off, an environment's deploy key. HQ keeps no request id for them:
 * after a lost answer, HQ's navigation showing the write's effect — absent at the send — adopts
 * it, and nothing is sent again blindly.
 *
 * @module data/operations/hqWrites
 */
import type { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import { hqAppsScope, type HqAppValue } from "../families/hqNavigation.ts";
import type { HqAttach, HqMateSetUp } from "../../zerops/hq/client.ts";
import { linkKeys, type OperationIntent } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import type { IntentOf, OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "set-auto-update-policy": { readonly orgId: string; readonly enabled: boolean };
    readonly "update-mate-face": {
      readonly orgId: string;
      readonly projectId: string;
      readonly face: string;
    };
    readonly "create-app": {
      readonly orgId: string;
      readonly name: string;
    };
    readonly "record-birth": {
      readonly orgId: string;
      readonly appId: string;
      readonly face: string;
      readonly standUp?: boolean;
    };
    readonly "bind-birth": {
      readonly orgId: string;
      readonly appId: string;
      readonly birthId: string;
      readonly projectId: string;
    };
    readonly "attach-project": {
      readonly orgId: string;
      readonly appId: string;
      readonly attach: HqAttach;
    };
    readonly "create-mate-record": {
      readonly orgId: string;
      readonly mate: { readonly projectId: string } & HqMateSetUp;
    };
    readonly "mark-closed-off": {
      readonly orgId: string;
      readonly projectId: string;
    };
    readonly "keep-deploy-key": {
      readonly orgId: string;
      readonly appId: string;
      /** The environment's project, which its token is granted on alone. */
      readonly projectId: string;
      /** Its name, as HQ named it with its attach. */
      readonly environmentName: string;
    };
  }
  interface OperationResults {
    readonly "set-auto-update-policy": { readonly policy: HqAutoUpdatePolicy };
    readonly "create-app": { readonly appId: string };
    readonly "record-birth": { readonly birthId: string };
  }
}

const appOf = (read: ProjectionReads, appId: string): HqAppValue | undefined => {
  const app = read.fact("hqApp", appId);
  return app.kind === "known" ? app.value : undefined;
};
const placementOf = (read: ProjectionReads, projectId: string) => {
  const placement = read.fact("placement", projectId);
  return placement.kind === "known" ? placement.value : undefined;
};
const birthsOf = (read: ProjectionReads, appId: string) => appOf(read, appId)?.births ?? [];

/** A kind whose effect a fact of HQ's navigation shows, and whose answer is its end. */
function shown<Kind extends keyof import("../model.ts").OperationIntents & string>(
  kind: Kind,
  targetOf: (intent: IntentOf<Kind>) => string,
  shows: (read: ProjectionReads, intent: IntentOf<Kind>) => boolean,
): OperationKind<Kind> {
  return { kind, executor: "hq", ...shownInFacts(targetOf, shows) };
}

/** A kind that makes a record HQ names: its id is the handle and the result. */
function made<Kind extends "create-app" | "record-birth">(
  kind: Kind,
  /** The ids of the records HQ's navigation holds that this intent would have made. */
  candidates: (read: ProjectionReads, intent: IntentOf<Kind>) => ReadonlyArray<string> | null,
  resultOf: (id: string) => Kind extends "create-app" ? { appId: string } : { birthId: string },
): OperationKind<Kind> {
  const holds = (read: ProjectionReads, intent: IntentOf<Kind>, id: string) =>
    (candidates(read, intent) ?? []).includes(id);
  return {
    kind,
    executor: "hq",
    reflected: (read, intent, receipt) => holds(read, intent, receipt.handles[0] ?? ""),
    // Its answer is its end; an adopted one is done as the record it adopted shows.
    settledBy: (read, intent, receipt) =>
      holds(read, intent, receipt.handles[0] ?? "") ? { kind: "succeeded" } : null,
    effectHandles: candidates,
    adoptedResult: resultOf as never,
  };
}

export const createApp = made(
  "create-app",
  (read, intent) => {
    const scope = hqAppsScope(intent.orgId);
    const apps = read.members(scope);
    if (
      apps.coverage !== "complete" ||
      read.stream(scope).phase !== "live" ||
      read.stream(linkKeys.hq(intent.orgId)).phase !== "live"
    )
      return null;
    return apps.ids.filter((id) => appOf(read, id)?.name === intent.name);
  },
  (appId) => ({ appId }),
);

export const recordBirth = made(
  "record-birth",
  (read, intent) => {
    const app = read.fact("hqApp", intent.appId);
    if (
      app.kind !== "known" ||
      app.value.births === undefined ||
      read.stream(app.scope).phase !== "live" ||
      read.stream(linkKeys.hq(intent.orgId)).phase !== "live"
    )
      return null;
    return app.value.births
      .filter((birth) => birth.face === intent.face && birth.projectId == null)
      .map((birth) => birth.id);
  },
  (birthId) => ({ birthId }),
);

export const bindBirth = shown(
  "bind-birth",
  (intent) => intent.birthId,
  (read, intent) =>
    birthsOf(read, intent.appId).some(
      (birth) => birth.id === intent.birthId && birth.projectId === intent.projectId,
    ) || placementOf(read, intent.projectId)?.mate?.birthId === intent.birthId,
);

export const attachProject = shown(
  "attach-project",
  (intent) => intent.attach.projectId,
  (read, intent) => {
    const placement = placementOf(read, intent.attach.projectId);
    return placement?.appId === intent.appId && placement.kind === intent.attach.kind;
  },
);

export const createMateRecord = shown(
  "create-mate-record",
  (intent) => intent.mate.projectId,
  (read, intent) => (placementOf(read, intent.mate.projectId)?.mate ?? null) !== null,
);

export const markClosedOff = shown(
  "mark-closed-off",
  (intent) => intent.projectId,
  (read, intent) => placementOf(read, intent.projectId)?.mate?.closedOff === true,
);

/** The environment's key, as HQ's navigation says it: held, and not found broken. */
export const deployKeyShown = (
  read: ProjectionReads,
  intent: Pick<IntentOf<"keep-deploy-key">, "appId" | "projectId">,
): boolean => {
  const environments = appOf(read, intent.appId)?.environments;
  return (
    Array.isArray(environments) &&
    environments.some(
      (environment) =>
        environment.projectId === intent.projectId &&
        environment.keyHeld &&
        !environment.keyInvalid,
    )
  );
};

export const keepDeployKey = shown("keep-deploy-key", (intent) => intent.projectId, deployKeyShown);

export const updateMateFace = shown(
  "update-mate-face",
  (intent) => intent.projectId,
  (read, intent) => placementOf(read, intent.projectId)?.mate?.face === intent.face,
);

/** Each HQ write's kind. */
export const setAutoUpdatePolicy: OperationKind<"set-auto-update-policy"> = {
  kind: "set-auto-update-policy",
  executor: "hq",
  reflected: (read, intent, receipt) => {
    const policy = read.fact("hqAutoUpdatePolicy", intent.orgId);
    const result = receipt.acceptance.kind === "accepted" ? receipt.acceptance.result : undefined;
    return (
      policy.kind === "known" &&
      result !== undefined &&
      "policy" in result &&
      result.policy.epoch !== undefined &&
      policy.value.epoch === result.policy.epoch &&
      policy.value.revision >= result.policy.revision
    );
  },
  // No adoption predicate: another admin's identical write cannot settle our lost answer.
};
export const HQ_WRITE_KINDS = [
  setAutoUpdatePolicy,
  updateMateFace,
  createApp,
  recordBirth,
  bindBirth,
  attachProject,
  createMateRecord,
  markClosedOff,
  keepDeployKey,
] as const;

export type HqWriteIntent = Extract<
  OperationIntent,
  { readonly kind: (typeof HQ_WRITE_KINDS)[number]["kind"] }
>;
