/**
 * The writes a creation makes at HQ, which HQ executes and answers at once: an application, a
 * Mate's birth, the Continue of an operation waiting for its maker, a project attached to an
 * application, an environment's deploy key, a Mate's hand-over. HQ keeps no
 * request id for them: after a lost answer, HQ's navigation showing the write's effect — absent at
 * the send — adopts it, and nothing is sent again blindly.
 *
 * @module data/operations/hqWrites
 */
import type { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import { hqAppsScope, type HqAppValue } from "../families/hqNavigation.ts";
import type { HqAttach, HqCreateBirth } from "../../zerops/hq/client.ts";
import { linkKeys, removedForViewer, type OperationIntent } from "../model.ts";
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
    readonly "create-birth": HqCreateBirth & { readonly orgId: string };
    /**
     * An operation waiting for its maker (a birth's: its id), given their current access token;
     * `projectId` where it is the operation HQ shows on that project (a Mate's deletion), `appId`
     * where HQ shows it on that application or one of its productions (its deletion, a removal).
     */
    readonly "continue-operation": {
      readonly orgId: string;
      readonly id: string;
      readonly projectId?: string;
      readonly appId?: string;
    };
    /**
     * A Mate's deletion, which HQ runs as its operation `id` on the person's token; `keptGit: "keep"`
     * keeps its application's Git once its last Mate is gone.
     */
    readonly "start-mate-deletion": {
      readonly orgId: string;
      readonly projectId: string;
      readonly id: string;
      readonly keptGit?: "keep";
    };
    /**
     * A production's removal, which HQ runs as its operation `id` on the person's token, deleting
     * its project too where `deleteProject` (the fate the person reviewed).
     */
    readonly "start-production-removal": {
      readonly orgId: string;
      readonly appId: string;
      readonly projectId: string;
      readonly id: string;
      readonly deleteProject: boolean;
    };
    /**
     * An application's deletion with its code, which HQ runs as its operation `id` on the person's
     * token: `stages`, the stage projects the person reviewed, go from Zerops first.
     */
    readonly "start-app-deletion": {
      readonly orgId: string;
      readonly appId: string;
      readonly id: string;
      readonly stages: ReadonlyArray<string>;
    };
    readonly "delete-birth": {
      readonly orgId: string;
      readonly appId: string;
      readonly birthId: string;
    };
    readonly "attach-project": {
      readonly orgId: string;
      readonly appId: string;
      readonly attach: HqAttach;
    };
    /** A Mate handed over to `ownerUserId` (a person's id), by HQ with the person's token. */
    readonly "hand-over-mate": {
      readonly orgId: string;
      readonly projectId: string;
      readonly ownerUserId: string;
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
    readonly "create-birth": { readonly appId: string; readonly birthId: string };
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

/** The applications HQ's navigation holds that this create would have made; `null` while unsure. */
const appsNamed = (
  read: ProjectionReads,
  intent: IntentOf<"create-app">,
): ReadonlyArray<string> | null => {
  const scope = hqAppsScope(intent.orgId);
  const apps = read.members(scope);
  if (
    apps.coverage !== "complete" ||
    read.stream(scope).phase !== "live" ||
    read.stream(linkKeys.hq(intent.orgId)).phase !== "live"
  )
    return null;
  return apps.ids.filter((id) => appOf(read, id)?.name === intent.name);
};
const holdsApp = (read: ProjectionReads, intent: IntentOf<"create-app">, appId: string) =>
  (appsNamed(read, intent) ?? []).includes(appId);

/** An application HQ names: its id is the handle and the result. */
const createApp: OperationKind<"create-app"> = {
  kind: "create-app",
  executor: "hq",
  reflected: (read, intent, receipt) => holdsApp(read, intent, receipt.handles[0] ?? ""),
  // Its answer is its end; an adopted one is done as the application it adopted shows.
  settledBy: (read, intent, receipt) =>
    holdsApp(read, intent, receipt.handles[0] ?? "") ? { kind: "succeeded" } : null,
  effectHandles: appsNamed,
  adoptedResult: (appId) => ({ appId }),
};

/** The birth whose operation is `id`, in whichever application of the organization holds it. */
const operationBirth = (read: ProjectionReads, orgId: string, id: string) =>
  read
    .members(hqAppsScope(orgId))
    .ids.flatMap((appId) => birthsOf(read, appId))
    .find((birth) => birth.id === id);

const createBirth: OperationKind<"create-birth"> = {
  kind: "create-birth",
  executor: "hq",
  // In the application it names, or, for a new one, the application HQ answered with; a Mate on a
  // project that exists, where HQ places it: the project's open birth holds the id.
  reflected: (read, intent, receipt) => {
    const result = receipt.acceptance.kind === "accepted" ? receipt.acceptance.result : undefined;
    const appId =
      intent.appId ?? (result !== undefined && "appId" in result ? result.appId : undefined);
    if (appId !== undefined && birthsOf(read, appId).some((birth) => birth.id === intent.id))
      return true;
    return (
      intent.projectId !== undefined &&
      (placementOf(read, intent.projectId)?.mate?.birthId === intent.id ||
        operationBirth(read, intent.orgId, intent.id)?.projectId === intent.projectId)
    );
  },
};

/**
 * HQ's answer is its end. Its operation — a birth's, an access change's `access:<id>`, or one HQ
 * shows on a project or an application — waiting for nobody's Continue shows it: HQ took the fresh
 * token, and a lost answer is adopted once navigation shows that (`continueBy` was present at the
 * send, or Continue was not offered). A project's operation also shows it by giving way to another,
 * or by its project no longer placed: it ran on to its end.
 */
const continueOperation = shown(
  "continue-operation",
  (intent) => intent.id,
  (read, intent) => {
    if (intent.appId !== undefined) {
      const app = read.fact("hqApp", intent.appId);
      if (removedForViewer(app)) return true;
      if (app.kind !== "known") return false;
      const operation = [
        app.value.operation,
        ...(app.value.environments ?? []).map((environment) =>
          "operation" in environment ? environment.operation : undefined,
        ),
      ].find((shown) => shown?.id === intent.id);
      return operation?.continueBy === undefined;
    }
    if (intent.projectId === undefined) {
      const birth = operationBirth(read, intent.orgId, intent.id);
      if (birth !== undefined)
        return birth.operation !== undefined && birth.operation.continueBy === undefined;
      const access = read.fact("hqAccessOperation", intent.id);
      return (
        access.kind === "known" &&
        access.value.operation !== null &&
        access.value.operation.continueBy === undefined
      );
    }
    const placement = read.fact("placement", intent.projectId);
    if (removedForViewer(placement)) return true;
    if (placement.kind !== "known") return false;
    const operation = placement.value.operation;
    return operation?.id !== intent.id || operation.continueBy === undefined;
  },
);

/**
 * HQ's answer is its end: its operation runs on without the tab. Navigation showing the project's
 * deletion open, or the project no longer placed, adopts a lost answer.
 */
const startMateDeletion = shown(
  "start-mate-deletion",
  (intent) => intent.projectId,
  (read, intent) => {
    const placement = read.fact("placement", intent.projectId);
    if (removedForViewer(placement)) return true;
    const operation = placement.kind === "known" ? placement.value.operation : undefined;
    return operation?.kind === "mate_deletion" && operation.failure === undefined;
  },
);

/**
 * HQ's answer is its end. Navigation showing the production's removal open, or the production no
 * longer among its application's environments, adopts a lost answer.
 */
const startProductionRemoval = shown(
  "start-production-removal",
  (intent) => intent.projectId,
  (read, intent) => {
    const app = read.fact("hqApp", intent.appId);
    if (removedForViewer(app)) return true;
    if (app.kind !== "known" || app.value.environments === undefined) return false;
    const production = app.value.environments.find(
      (environment) =>
        environment.tier === "production" &&
        environment.target.kind === "zerops" &&
        environment.target.projectId === intent.projectId,
    );
    if (production === undefined) return true;
    const operation = "operation" in production ? production.operation : undefined;
    return operation?.kind === "production_removal" && operation.failure === undefined;
  },
);

/**
 * HQ's answer is its end. Navigation showing the application's deletion open, or the application
 * gone, adopts a lost answer.
 */
const startAppDeletion = shown(
  "start-app-deletion",
  (intent) => intent.appId,
  (read, intent) => {
    const app = read.fact("hqApp", intent.appId);
    if (removedForViewer(app)) return true;
    const operation = app.kind === "known" ? app.value.operation : undefined;
    return operation?.kind === "app_deletion" && operation.failure === undefined;
  },
);

/** Absence is evidence only in the live, complete birth list of the known application. */
const deleteBirth: OperationKind<"delete-birth"> = {
  kind: "delete-birth",
  executor: "hq",
  ...shownInFacts(
    (intent) => intent.birthId,
    (read, intent) => {
      const app = read.fact("hqApp", intent.appId);
      return (
        app.kind === "known" &&
        app.value.births !== undefined &&
        read.stream(app.scope).phase === "live" &&
        read.stream(linkKeys.hq(intent.orgId)).phase === "live" &&
        !app.value.births.some((birth) => birth.id === intent.birthId)
      );
    },
  ),
  effectHandles: (read, intent) => {
    const app = read.fact("hqApp", intent.appId);
    if (
      app.kind !== "known" ||
      app.value.births === undefined ||
      read.stream(app.scope).phase !== "live" ||
      read.stream(linkKeys.hq(intent.orgId)).phase !== "live"
    )
      return null;
    return app.value.births.some((birth) => birth.id === intent.birthId) ? [] : [intent.birthId];
  },
};

const attachProject = shown(
  "attach-project",
  (intent) => intent.attach.projectId,
  (read, intent) => {
    const placement = placementOf(read, intent.attach.projectId);
    return placement?.appId === intent.appId && placement.kind === intent.attach.kind;
  },
);

/** The environment's key, as HQ's navigation says it: held, and not found broken. */
const deployKeyShown = (
  read: ProjectionReads,
  intent: Pick<IntentOf<"keep-deploy-key">, "appId" | "projectId">,
): boolean => {
  const environments = appOf(read, intent.appId)?.environments;
  return (
    Array.isArray(environments) &&
    environments.some(
      (environment) =>
        environment.target.kind === "zerops" &&
        environment.target.projectId === intent.projectId &&
        environment.keyHeld &&
        !environment.keyInvalid,
    )
  );
};

const keepDeployKey = shown("keep-deploy-key", (intent) => intent.projectId, deployKeyShown);

/**
 * The deploy token HQ's navigation says it keeps for the application's environment on `projectId`,
 * with its Zerops id where HQ records one: what the client deletes once HQ no longer keeps it.
 */
export const keptDeployToken = (
  read: ProjectionReads,
  appId: string,
  projectId: string,
): { readonly id: string | undefined } | undefined => {
  const environments = appOf(read, appId)?.environments;
  const kept = Array.isArray(environments)
    ? environments.find(
        (environment) =>
          environment.target.kind === "zerops" &&
          environment.target.projectId === projectId &&
          environment.keyHeld,
      )
    : undefined;
  return kept === undefined ? undefined : { id: kept.keyId };
};

const updateMateFace = shown(
  "update-mate-face",
  (intent) => intent.projectId,
  (read, intent) => placementOf(read, intent.projectId)?.mate?.face === intent.face,
);

/**
 * HQ's `204` is its end: the Mate's owner and key are replaced. Its navigation shows it as the
 * person picked named its owner and its key no longer refused — what adopts a lost answer, never
 * what ends an answered one (a person who handed their own Mate away may no longer read it).
 */
const handedOver = (read: ProjectionReads, intent: IntentOf<"hand-over-mate">) => {
  const placement = placementOf(read, intent.projectId);
  return (
    placement?.person?.ownerUserId === intent.ownerUserId && placement.mate?.keyRefused !== true
  );
};
const handOverMate: OperationKind<"hand-over-mate"> = {
  kind: "hand-over-mate",
  executor: "hq",
  reflected: (read, intent) => handedOver(read, intent),
  // Ends an adopted lost answer; an answered one HQ's receipt ended already.
  settledBy: (read, intent) => (handedOver(read, intent) ? { kind: "succeeded" } : null),
  effectHandles: (read, intent) =>
    placementOf(read, intent.projectId) === undefined
      ? null
      : handedOver(read, intent)
        ? [intent.projectId]
        : [],
};

/** Each HQ write's kind. */
const setAutoUpdatePolicy: OperationKind<"set-auto-update-policy"> = {
  kind: "set-auto-update-policy",
  executor: "hq",
  reflected: (read, intent, receipt) => {
    const policy = read.fact("hqAutoUpdatePolicy", intent.orgId);
    const result = receipt.acceptance.kind === "accepted" ? receipt.acceptance.result : undefined;
    return (
      policy.kind === "known" &&
      result !== undefined &&
      "policy" in result &&
      policy.value.revision >= result.policy.revision
    );
  },
  // No adoption predicate: another admin's identical write cannot settle our lost answer.
};
export const HQ_WRITE_KINDS = [
  setAutoUpdatePolicy,
  updateMateFace,
  createApp,
  createBirth,
  continueOperation,
  startMateDeletion,
  startProductionRemoval,
  startAppDeletion,
  deleteBirth,
  attachProject,
  keepDeployKey,
  handOverMate,
] as const;

export type HqWriteIntent = Extract<
  OperationIntent,
  { readonly kind: (typeof HQ_WRITE_KINDS)[number]["kind"] }
>;
