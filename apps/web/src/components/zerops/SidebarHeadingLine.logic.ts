import type { GitDelivery } from "@t3tools/client-runtime/zerops";
/**
 * A project heading's second line (D′): under the name and above the Mates, one line that says
 * what the project's environments are doing — never a row after the Mates, which reads as the
 * last Mate's.
 *
 * The release is the road's (`SidebarRoad.logic.ts`): what waits, what is on its way and what
 * did not go out ride between its places, so the line never says them again. While a stage or a
 * production comes up the line names each step: "Stage coming up · building the app", then
 * "Stage is up", or "Stage didn’t come up" in amber with Details; "v2.4.0 is live" stands for
 * 4 s in the tab that watched it go out. Where an environment has got is client-runtime's rule
 * (`stopComing`), which a phone says too.
 *
 * A build or deploy Zerops runs on an environment says so — "Stage is deploying…" — until Zerops
 * says it ended.
 *
 * One line at a time: trouble, then an environment coming up, then what landed, then a deploy.
 * Down and stopped are the road's alone.
 *
 * Pure: no clock of its own, no platform globals.
 */
import { comingLine, type StopComing } from "@t3tools/client-runtime/zerops";

import { placeTitle, type ChipState, type ProductionChip } from "./SidebarProductionChip.logic";

/** How long "is live" and "is up" stand on the line before it folds. */
export const LANDING_MS = 4_000;

/** What the line is made of, besides what only this tab saw land (`HeadingLanding`). */
export interface HeadingLineInput {
  /** `undefined` where the project has no production, nor one on its way. */
  readonly production:
    | {
        readonly projectId: string | undefined;
        readonly git?: GitDelivery | undefined;
        /** Its pill, as the heading draws it; `undefined` while unread. */
        readonly chip: ProductionChip | undefined;
        readonly coming: StopComing | undefined;
        /** A build or deploy of it runs now, as Zerops says (`runningWork`). */
        readonly building: boolean;
      }
    | undefined;
  readonly stages: ReadonlyArray<{
    readonly git?: GitDelivery | undefined;
    readonly projectId: string;
    readonly name: string;
    readonly coming: StopComing | undefined;
    /** It serves: a deploy ran and it has a public address (`stopServes`). */
    readonly serves: boolean;
    /** A build or deploy of it runs now, as Zerops says (`runningWork`). */
    readonly building: boolean;
  }>;
}

/** What this tab watched land, standing on the line for {@link LANDING_MS}. */
export type HeadingLanding =
  | { readonly kind: "live"; readonly version: string }
  | { readonly kind: "up"; readonly name: string };

export type HeadingLineVerb = { readonly kind: "details"; readonly projectId: string | undefined };

export interface HeadingLine {
  /** The fact, in the line's tone; the rest follows it muted, after a middle dot. */
  readonly fact: string;
  readonly rest: string | undefined;
  readonly tone: "ink" | "ok" | "amber";
  /** A deploy on its way: the stepped spinner before the fact. */
  readonly spinner: boolean;
  /** The line is a release's — one this tab watched go live: it leads with the release's tag. */
  readonly release: boolean;
  /** The door at the line's end. */
  readonly verb: HeadingLineVerb | undefined;
}

/** "Stage", or the stage's own name where the project has several. */
function stageWord(
  stages: HeadingLineInput["stages"],
  stage: HeadingLineInput["stages"][number],
): string {
  return stages.length > 1 ? placeTitle(stage.name) : "Stage";
}

/** Production's pill states that serve something a release was cut from. */
const RELEASED: ReadonlySet<ChipState> = new Set(["ok", "waiting"]);

/**
 * The heading's second line, or none: trouble first — an environment that did not come up — then
 * an environment coming up, then what this tab watched land, then a deploy under way.
 */
export function headingLine(
  input: HeadingLineInput,
  landing: HeadingLanding | undefined,
): HeadingLine | undefined {
  const { production, stages } = input;
  const git = production?.git ?? stages.find((stage) => stage.git !== undefined)?.git;

  if (production?.coming?.kind === "failed") {
    return {
      fact: "Production didn’t come up",
      rest: production.coming.reason,
      tone: "amber",
      spinner: false,
      release: false,
      verb: { kind: "details", projectId: production.projectId },
    };
  }
  for (const stage of stages) {
    if (stage.coming?.kind !== "failed") continue;
    return {
      fact: `${stageWord(stages, stage)} didn’t come up`,
      rest: stage.coming.reason,
      tone: "amber",
      spinner: false,
      release: false,
      verb: { kind: "details", projectId: stage.projectId },
    };
  }
  if (git !== undefined)
    return {
      fact: git.line,
      rest: undefined,
      tone: git.blocked || git.standing === "partly" ? "amber" : "ink",
      spinner: git.standing === "pushing",
      release: false,
      verb: {
        kind: "details",
        projectId:
          production?.git !== undefined
            ? production.projectId
            : stages.find((stage) => stage.git === git)?.projectId,
      },
    };
  if (production?.coming?.kind === "coming") {
    return {
      ...comingLine("Production", production.coming),
      tone: "ink",
      spinner: false,
      release: false,
      verb: undefined,
    };
  }
  for (const stage of stages) {
    if (stage.coming?.kind !== "coming") continue;
    return {
      ...comingLine(stageWord(stages, stage), stage.coming),
      tone: "ink",
      spinner: false,
      release: false,
      // Held for a key: its page mints one, or names who may.
      verb:
        stage.coming.step === "awaiting-key"
          ? { kind: "details", projectId: stage.projectId }
          : undefined,
    };
  }
  if (landing !== undefined) {
    return {
      fact: landing.kind === "live" ? `${landing.version} is live` : `${landing.name} is up`,
      rest: "just now",
      tone: "ok",
      spinner: false,
      release: landing.kind === "live",
      verb: undefined,
    };
  }
  // A build or deploy under way, until Zerops says it ended: never on an estimate.
  if (production?.building === true)
    return {
      fact: "Production is deploying…",
      rest: undefined,
      tone: "ink",
      spinner: true,
      release: false,
      verb: undefined,
    };
  const deploying = stages.find((stage) => stage.building);
  if (deploying !== undefined)
    return {
      fact: `${stageWord(stages, deploying)} is deploying…`,
      rest: undefined,
      tone: "ink",
      spinner: true,
      release: false,
      verb: undefined,
    };
  return undefined;
}

/**
 * What landed between two readings, as this tab watched it: a release on its way now served
 * ("v2.4.0 is live"), production's first build serving ("v0.1.0 is live"), a stage that was
 * coming up now serving ("Stage is up"). Nothing where this tab did not see it on its way.
 */
export function headingLanding(
  before: HeadingLineInput | undefined,
  after: HeadingLineInput,
): HeadingLanding | undefined {
  if (before === undefined) return undefined;
  const was = before.production;
  const now = after.production?.chip;
  if (
    after.production?.git === undefined &&
    now !== undefined &&
    RELEASED.has(now.state) &&
    now.version !== undefined
  ) {
    if (was?.chip?.state === "releasing" || was?.coming?.kind === "coming") {
      return { kind: "live", version: now.version };
    }
  }
  for (const stage of after.stages) {
    // Up only where it serves: a coming-up window that ended is not a landing.
    if (stage.git !== undefined || stage.coming !== undefined || !stage.serves) continue;
    const earlier = before.stages.find((entry) => entry.projectId === stage.projectId);
    if (earlier?.coming?.kind === "coming") {
      return { kind: "up", name: stageWord(after.stages, stage) };
    }
  }
  return undefined;
}
