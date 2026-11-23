/**
 * The writes a creation makes at HQ, which HQ executes and answers at once: a Mate's birth, the Continue of an operation waiting for its maker, a project attached to an
 * application, a Mate's hand-over. HQ keeps no
 * request id for them: after a lost answer, HQ's navigation showing the write's effect — absent at
 * the send — adopts it, and nothing is sent again blindly.
 *
 * @module data/operations/hqWrites
 */
import type { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import { hqAppsScope, type HqAppValue } from "../families/hqNavigation.ts";
import type {
  HqCreateBirth,
  HqEnvironmentStart,
  HqProjectMoveStart,
  HqPutLiveStart,
} from "../../zerops/hq/client.ts";
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
     * An Owner's or an Admin's end of the application `appId`'s operation `id`, which waits for a
     * maker who cannot continue it.
     */
    readonly "end-operation": {
      readonly orgId: string;
      readonly id: string;
      readonly appId: string;
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
    /** A failed Mate's restart, which HQ runs as its operation `id` on the person's token. */
    readonly "start-mate-restart": {
      readonly orgId: string;
      readonly projectId: string;
      readonly id: string;
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
    /**
     * A stage or a production added to the application, which HQ runs as its `environment`
     * operation `start.id` on the person's token.
     */
    readonly "start-environment": {
      readonly orgId: string;
      readonly appId: string;
      readonly start: HqEnvironmentStart;
    };
    /**
     * The deploy key of the application's environment `name` set up or renewed, which HQ runs as
     * its `deploy_key` operation `id` on the person's token.
     */
    readonly "start-deploy-key": {
      readonly orgId: string;
      readonly appId: string;
      readonly name: string;
      readonly id: string;
    };
    /**
     * The application's *Put it live*, which HQ runs as its `put_live` operation `start.id` on the
     * person's token: its production made, then released to.
     */
    readonly "start-put-live": {
      readonly orgId: string;
      readonly appId: string;
      readonly start: HqPutLiveStart;
    };
    /**
     * A project's move, which HQ runs as its operation `id` on the person's token: its placement
     * (with `newApp`, into a new application) at once, its Zerops name after its application then.
     */
    readonly "start-project-move": HqProjectMoveStart & {
      readonly orgId: string;
      readonly projectId: string;
    };
    /**
     * An application's rename, which HQ runs as its operation `id` on the person's token: its name
     * at once, each of its projects' Zerops names after it then.
     */
    readonly "start-app-rename": {
      readonly orgId: string;
      readonly appId: string;
      readonly id: string;
      readonly name: string;
    };
    readonly "delete-birth": {
      readonly orgId: string;
      readonly appId: string;
      readonly birthId: string;
    };
    /** A Mate handed over to `ownerUserId` (a person's id), by HQ with the person's token. */
    readonly "hand-over-mate": {
      readonly orgId: string;
      readonly projectId: string;
      readonly ownerUserId: string;
    };
  }
  interface OperationResults {
    readonly "set-auto-update-policy": { readonly policy: HqAutoUpdatePolicy };
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
 * HQ's answer is its end. The application showing the operation ended (its failure `ended`), or
 * no longer showing it, adopts a lost answer. One shown running is not ended: its maker's Continue
 * may have won.
 */
const endOperation = shown(
  "end-operation",
  (intent) => intent.id,
  (read, intent) => {
    const app = read.fact("hqApp", intent.appId);
    if (removedForViewer(app)) return true;
    if (app.kind !== "known") return false;
    return app.value.operation?.id !== intent.id || app.value.operation.failure?.code === "ended";
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
 * HQ's answer is its end. Navigation showing the restart under its id on the project, open or
 * ended, or the project no longer placed, adopts a lost answer.
 */
const startMateRestart = shown(
  "start-mate-restart",
  (intent) => intent.projectId,
  (read, intent) => {
    const placement = read.fact("placement", intent.projectId);
    if (removedForViewer(placement)) return true;
    return placement.kind === "known" && placement.value.operation?.id === intent.id;
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

/**
 * HQ's answer is its end: its operation runs on without the tab. Navigation showing the operation
 * under its id on the application, open or ended, adopts a lost answer; the same id sent again is
 * answered as taken.
 */
const startEnvironment = shown(
  "start-environment",
  (intent) => intent.appId,
  (read, { appId, start }) => appOf(read, appId)?.operation?.id === start.id,
);

const startDeployKey = shown(
  "start-deploy-key",
  (intent) => intent.appId,
  (read, intent) => appOf(read, intent.appId)?.operation?.id === intent.id,
);

const startPutLive = shown(
  "start-put-live",
  (intent) => intent.appId,
  (read, intent) => appOf(read, intent.appId)?.operation?.id === intent.start.id,
);

/**
 * HQ's answer is its end: its operation runs on without the tab. Navigation showing the project
 * with this move (`id`), or placed where it moves in an application that stands (the start writes
 * the placement, and a move that ended done shows no operation), adopts a lost answer.
 */
const startProjectMove = shown(
  "start-project-move",
  (intent) => intent.projectId,
  (read, intent) => {
    const placement = placementOf(read, intent.projectId);
    return (
      placement?.operation?.id === intent.id ||
      (intent.to.appId !== null &&
        placement?.appId === intent.to.appId &&
        placement.kind === intent.to.kind)
    );
  },
);

/**
 * HQ's answer is its end. Navigation showing the application with this rename (`id`), or with the
 * new name (the start writes it, and a rename that ended done shows no operation), adopts a lost
 * answer.
 */
const startAppRename: OperationKind<"start-app-rename"> = {
  kind: "start-app-rename",
  executor: "hq",
  ...shownInFacts<IntentOf<"start-app-rename">>(
    (intent) => intent.appId,
    (read, intent) => {
      const app = appOf(read, intent.appId);
      return app?.operation?.id === intent.id || app?.name === intent.name;
    },
  ),
  effectHandles: (read, intent) => {
    const app = appOf(read, intent.appId);
    if (app?.operation?.id === intent.id) return [intent.id];
    return app?.name === intent.name ? [intent.appId] : [];
  },
};

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
  createBirth,
  continueOperation,
  endOperation,
  startMateDeletion,
  startMateRestart,
  startProductionRemoval,
  startAppDeletion,
  startEnvironment,
  startDeployKey,
  startPutLive,
  startProjectMove,
  startAppRename,
  deleteBirth,
  handOverMate,
] as const;

export type HqWriteIntent = Extract<
  OperationIntent,
  { readonly kind: (typeof HQ_WRITE_KINDS)[number]["kind"] }
>;
