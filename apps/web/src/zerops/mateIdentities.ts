/** Web presentation helpers for HQ identities and a Mate's explicit creation record. */
import {
  mateArriving,
  mateArrivingUntil,
  mateShapeOf,
  projectNameInApp,
  readZeropsMembership,
  type MatePoseFacts,
} from "@t3tools/client-runtime/zerops";
import {
  candidateContainerRuns,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";

import type { ZeropsEnvironmentEntry } from "../state/zerops";

export interface ZeropsMateIdentity {
  /** The exact container behind this environment; absent for a row that names no service. */
  readonly serviceId?: string | undefined;
  /** The Mate's own project; absent where only its creation knew it. */
  readonly projectId?: string | undefined;
  readonly name: string;
  readonly tint: MateTintId;
  /** The shape its person picked (HQ's record), else its tint's own — `mateShapeOf`. */
  readonly shape: MateShapeId;
  /** The project the Mate belongs to, as HQ names it; absent for one in no project. */
  readonly project: string | undefined;
  /** The Mate's project on the Zerops dashboard: where a conversation's "Open in Zerops" goes. */
  readonly projectUrl: string;
  /**
   * Whether this tab is connected to the Mate. HQ names it before that link opens,
   * so its name and face never imply a connected socket.
   */
  readonly connected: boolean;
  /** Whether the listing has its container running, independently of this tab's socket. */
  readonly running?: boolean | undefined;
  /**
   * Who asked for the project's development to be stood up (HQ's `standupRequestedBy`), while the
   * ask waits for their first sign-in: their empty conversation says so (`mateStandUp.ts`).
   */
  readonly standUp?: { readonly by: string } | undefined;
  /** Who made it (HQ's `madeBy`): whose sign-in it waits for while nobody has signed it in. */
  readonly madeBy?: string | undefined;
  /** Until when it is arriving (`mateArrivingUntil`); absent once it has arrived, or not known. */
  readonly arrivingUntil?: number | undefined;
  /** Its overview says it runs on an agent Mate signs nobody in to (HQ's overview). */
  readonly runsWithoutSignIn?: boolean | undefined;
}

/** What a Mate's face reads of where it is in its life, from who lives there (`mateFaceFor`). */
export function mateIdentityPose(
  mate: Pick<ZeropsMateIdentity, "arrivingUntil">,
  nowMs: number,
): MatePoseFacts {
  return { arriving: mateArriving(mate.arrivingUntil, nowMs) };
}

/** A creation page's candidate before HQ registers it; route identities come from HQ. */
export function zeropsMateIdentityOf(
  candidate: ZeropsCandidate,
  tints: ReadonlyMap<string, MateTintId>,
): ZeropsMateIdentity {
  const tags = readZeropsMembership(candidate.project);
  const tint = tints.get(candidate.project.id) ?? "slate";
  const arrivingUntil = mateArrivingUntil(candidate);
  return {
    serviceId: candidate.service?.id,
    projectId: candidate.project.id,
    name: projectNameInApp(candidate.project),
    tint,
    shape: mateShapeOf(candidate.project, tint),
    project: tags.label,
    projectUrl: zeropsProjectUrl(candidate.project.id),
    connected: candidate.group === "connected",
    running: candidateContainerRuns(candidate),
    ...(tags.standUp === undefined ? {} : { standUp: tags.standUp }),
    ...(tags.madeBy === undefined ? {} : { madeBy: tags.madeBy }),
    ...(arrivingUntil === undefined ? {} : { arrivingUntil }),
    ...(candidate.project.hq?.mate?.runsWithoutSignIn === true ? { runsWithoutSignIn: true } : {}),
  };
}

/**
 * Whether a Mate's opening wears its face awake: the account's listing has its container up — its
 * socket not open yet is this page's wait, not the Mate's sleep.
 */
export function mateOpeningAwake(mate: Pick<ZeropsMateIdentity, "connected" | "running">): boolean {
  return mate.connected || mate.running === true;
}

/**
 * Whether a Mate's own page (`/mate/$projectId`) wears it awake: linked, or — while the page only
 * waits on its link — where its container runs (`mateOpeningAwake`). Asleep where the page speaks
 * of the link (a restart, a container that is not running, one that cannot be opened); a new Mate
 * arriving wears what its board says instead.
 */
export function mateStageAwake(input: {
  readonly linked: boolean;
  readonly arriving: boolean;
  readonly speaks: boolean;
  readonly mate: Pick<ZeropsMateIdentity, "connected" | "running">;
}): boolean {
  if (input.linked) return true;
  if (input.arriving || input.speaks) return false;
  return mateOpeningAwake(input.mate);
}

/** Who lives in one environment: its Mate, nobody, or not known yet. */
export type ZeropsMateAt =
  | { readonly kind: "mate"; readonly mate: ZeropsMateIdentity }
  | { readonly kind: "nobody" }
  | { readonly kind: "unknown" };

/**
 * Who lives in each environment, as far as it is known (DESIGN M4, M5): its Mate, or null where
 * nobody does. An environment it leaves out is not known yet.
 */
export type ZeropsMateDirectory = ReadonlyMap<EnvironmentId, ZeropsMateIdentity | null>;

const NOBODY: ZeropsMateAt = { kind: "nobody" };
const UNKNOWN: ZeropsMateAt = { kind: "unknown" };

export function zeropsMateAt(
  directory: ZeropsMateDirectory,
  environmentId: EnvironmentId,
): ZeropsMateAt {
  const mate = directory.get(environmentId);
  if (mate === undefined) return UNKNOWN;
  return mate === null ? NOBODY : { kind: "mate", mate };
}

/**
 * The directory with every environment whose own server says it runs outside
 * Zerops (its descriptor carries no `zerops`) decided: no Mate lives there,
 * whether or not the candidate list has been read. A Zerops environment, or
 * one whose server has not answered yet, waits for HQ to name its Mate.
 */
export function withEnvironmentsOutsideZerops(
  directory: ZeropsMateDirectory,
  environments: ReadonlyArray<Pick<ZeropsEnvironmentEntry, "environmentId" | "zeropsProjectId">>,
): ZeropsMateDirectory {
  const outside = environments.filter(
    ({ environmentId, zeropsProjectId }) =>
      zeropsProjectId === null && !directory.has(environmentId),
  );
  if (outside.length === 0) return directory;
  const decided = new Map(directory);
  for (const { environmentId } of outside) decided.set(environmentId, null);
  return decided;
}

/** The question an empty conversation asks: "What should Fen do on Acme Docs?" */
export function mateQuestion(mate: Pick<ZeropsMateIdentity, "name" | "project">): string {
  return mate.project === undefined
    ? `What should ${mate.name} do?`
    : `What should ${mate.name} do on ${mate.project}?`;
}
