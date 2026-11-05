/**
 * The writes a creation makes at HQ, which HQ executes and answers at once: an application, a
 * Mate's birth intent and its bind to a project, a project attached to an application, a Mate's
 * record in none, an environment's deploy key, a Mate's hand-over. HQ keeps no
 * request id for them: after a lost answer, HQ's navigation showing the write's effect — absent at
 * the send — adopts it, and nothing is sent again blindly.
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
      readonly id: string;
      readonly face: string;
      readonly intent?: Readonly<Record<string, unknown>>;
      readonly standUp?: boolean;
      readonly automated?: true;
    };
    readonly "bind-birth": {
      readonly orgId: string;
      readonly appId: string;
      readonly birthId: string;
      readonly projectId: string;
    };
    readonly "delete-birth": {
      readonly orgId: string;
      readonly appId: string;
      readonly birthId: string;
    };
    readonly "claim-birth-attempt": {
      readonly orgId: string;
      readonly birthId: string;
      readonly step: "create" | "import";
    };
    readonly "end-birth-attempt": {
      readonly orgId: string;
      readonly birthId: string;
      readonly step: "create" | "import";
      readonly outcome: "refused" | "unsent";
      readonly at: string;
      readonly reason: string;
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
    readonly "record-birth": { readonly birthId: string };
    readonly "claim-birth-attempt": {
      readonly claim: { readonly by: string; readonly at: string };
    };
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
    return app.value.births.filter((birth) => birth.id === intent.id).map((birth) => birth.id);
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

/** Absence is evidence only in the live, complete birth list of the known application. */
export const deleteBirth: OperationKind<"delete-birth"> = {
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

/** A lost claim answer cannot be adopted: even the same person may be in another tab. */
export const claimBirthAttempt: OperationKind<"claim-birth-attempt"> = {
  kind: "claim-birth-attempt",
  executor: "hq",
  reflected: () => false,
};

export const endBirthAttempt: OperationKind<"end-birth-attempt"> = {
  kind: "end-birth-attempt",
  executor: "hq",
  reflected: () => false,
};

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
        environment.target.kind === "zerops" &&
        environment.target.projectId === intent.projectId &&
        environment.keyHeld &&
        !environment.keyInvalid,
    )
  );
};

export const keepDeployKey = shown("keep-deploy-key", (intent) => intent.projectId, deployKeyShown);

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

export const updateMateFace = shown(
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
export const handOverMate: OperationKind<"hand-over-mate"> = {
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
  deleteBirth,
  claimBirthAttempt,
  endBirthAttempt,
  attachProject,
  createMateRecord,
  keepDeployKey,
  handOverMate,
] as const;

export type HqWriteIntent = Extract<
  OperationIntent,
  { readonly kind: (typeof HQ_WRITE_KINDS)[number]["kind"] }
>;
