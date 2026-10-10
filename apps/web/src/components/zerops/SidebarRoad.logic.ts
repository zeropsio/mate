/**
 * A project's road, after its name on the menu's heading: `stage ─▸ prod`. Its places are words;
 * each opens its chip's menu (`SidebarProductionChip`). What is ready to go out rides on the way
 * between them — a white chip, "3 ready", where it waits on the viewer and opens the release's
 * review; grey, "2 waiting", where the release is not offered (production must be fixed first);
 * a blue dot and the version while a release is on its way.
 *
 * Grey while all is well. A place's word takes a tone only where someone is needed or there is
 * news: amber for a release or deploy that did not go through while the old one serves, red for
 * down, blue while releasing, dim while stopped or with nothing released. Without a production
 * the way is dashed and *prod* dim; without a stage, *prod* alone.
 *
 * Built on the chips' own model (`projectChips`, `drawnChip`), so the road and the menus it opens
 * never disagree. Pure: no React, no clock, no store.
 */
import { changesCountWords } from "@t3tools/client-runtime/zerops";

import type { ChipState, ProductionChip } from "./SidebarProductionChip.logic";

/** A place word's tone, in the chips' own words (`ChipTone`), and blue while releasing. */
export type RoadTone = "amber" | "red" | "blue" | "off";

export interface RoadTip {
  readonly title: string;
  readonly lines: ReadonlyArray<string>;
}

export interface RoadPlace {
  readonly word: "stage" | "prod";
  readonly tone: RoadTone | undefined;
  /** No such place: *prod* dimmed, never a door. */
  readonly none: boolean;
  /** The place is there and not read yet: its word, grey, never a door until it is. */
  readonly unread: boolean;
  readonly tip: RoadTip;
}

export type RoadMid =
  | {
      readonly kind: "ready";
      readonly label: string;
      readonly tip: RoadTip;
    }
  | { readonly kind: "waiting"; readonly label: string; readonly tip: RoadTip }
  | { readonly kind: "releasing"; readonly label: string | undefined; readonly tip: RoadTip };

export interface Road {
  readonly stage: RoadPlace | undefined;
  /** The way from stage to prod: none without a stage, dashed without a production. */
  readonly way: "solid" | "dashed" | "none";
  readonly mid: RoadMid | undefined;
  readonly prod: RoadPlace;
}

export interface RoadInput {
  /**
   * The stages' chip as the heading draws it (`drawnChip`); `unread` where the project has stages
   * and none is read yet; `undefined` where it has none.
   */
  readonly stage: ProductionChip | "unread" | undefined;
  /** Production's chip as drawn; `unread` while it is not read yet; `undefined` where it has none. */
  readonly prod: ProductionChip | "unread" | undefined;
  /** Each stage's name, as the menu lists it. */
  readonly stageNames: ReadonlyArray<string>;
  /** Production's own name; `undefined` where the project has none. */
  readonly productionName: string | undefined;
  /** Changes merged and not live (`GroupFlowMain.notLive`). */
  readonly waiting: number;
  readonly waitingAtLeast: boolean;
  /** Whether HQ offers the viewer the release (`releaseGateOf`'s `allowed`). */
  readonly releaseOffered: boolean;
}

const TONE: Record<ChipState, RoadTone | undefined> = {
  ok: undefined,
  waiting: undefined,
  unverified: undefined,
  releasing: "blue",
  failed: "amber",
  down: "red",
  stopped: "off",
  empty: "off",
  creating: "off",
};

/** A chip's place word's tone: `neutral` where all is well. */
export function roadTone(chip: ProductionChip): RoadTone | "neutral" {
  return TONE[chip.state] ?? "neutral";
}

/** Production's states a release cannot go to until someone fixes it. */
const NEEDS_FIXING: ReadonlySet<ChipState> = new Set(["down", "failed", "stopped"]);

/** One place in plain words, as the card's production line says it. */
function placeWords(chip: ProductionChip, state: ChipState = chip.state): string {
  const prod = chip.label === "prod";
  const own = state === chip.state;
  const version = own ? chip.version : undefined;
  switch (state) {
    case "ok":
    case "waiting":
      return version === undefined ? "Running" : `Running · ${version}`;
    case "unverified":
      return (own ? chip.readLine : undefined) ?? "Checking what runs here…";
    case "releasing": {
      const next = own ? chip.next : undefined;
      return next === undefined ? "Deploying" : `Releasing ${next}`;
    }
    case "failed":
      return prod
        ? version === undefined
          ? "Release failed"
          : `Release failed · still runs ${version}`
        : "Last deploy failed";
    case "down":
      return "Down";
    case "stopped":
      return "Stopped";
    case "creating":
      return "Being set up";
    case "empty":
      return prod ? "Nothing released yet" : "Nothing deployed yet";
  }
}

const known = (chip: ProductionChip, words: string) =>
  chip.lastKnown ? `Last known: ${words}` : words;

const UNREAD_WORDS = "Reading what runs here…";

function stagePlace(chip: ProductionChip | "unread", names: ReadonlyArray<string>): RoadPlace {
  if (chip === "unread") {
    return {
      word: "stage",
      tone: undefined,
      none: false,
      unread: true,
      tip: { title: names.length > 1 ? "Stages" : "Stage", lines: [UNREAD_WORDS] },
    };
  }
  const several = chip.stages !== undefined && chip.stages.length > 1;
  const lines = several
    ? (chip.stages ?? []).map(
        ({ name, state }) => `${name}: ${known(chip, placeWords(chip, state))}`,
      )
    : [`${names[0] ?? "stage"}: ${known(chip, placeWords(chip))}`];
  return {
    word: "stage",
    tone: TONE[chip.state],
    none: false,
    unread: false,
    tip: { title: several ? "Stages" : "Stage", lines },
  };
}

/** The road of a project, or none where it has neither a stage nor a production. */
export function projectRoad(input: RoadInput): Road | undefined {
  const { prod, stage } = input;
  if (prod === undefined && stage === undefined) return undefined;
  const prodPlace: RoadPlace =
    prod === undefined
      ? {
          word: "prod",
          tone: undefined,
          none: true,
          unread: false,
          tip: { title: "Production", lines: ["Nothing is released yet"] },
        }
      : prod === "unread"
        ? {
            word: "prod",
            tone: undefined,
            none: false,
            unread: true,
            tip: { title: "Production", lines: [UNREAD_WORDS] },
          }
        : {
            word: "prod",
            tone: TONE[prod.state],
            none: false,
            unread: false,
            tip: {
              title: "Production",
              lines: [`${input.productionName ?? "prod"}: ${known(prod, placeWords(prod))}`],
            },
          };
  if (stage === undefined)
    return { stage: undefined, way: "none", mid: undefined, prod: prodPlace };
  return {
    stage: stagePlace(stage, input.stageNames),
    way: prod === undefined ? "dashed" : "solid",
    mid: prod === undefined || prod === "unread" ? undefined : midOf(input, prod),
    prod: prodPlace,
  };
}

function midOf(input: RoadInput, prod: ProductionChip): RoadMid | undefined {
  if (prod.state === "releasing") {
    return {
      kind: "releasing",
      label: prod.next,
      tip: {
        title: prod.next === undefined ? "Deploying" : `Releasing ${prod.next}`,
        lines: ["Production takes the new version"],
      },
    };
  }
  if (input.waiting <= 0) return undefined;
  const count = `${String(input.waiting)}${input.waitingAtLeast ? "+" : ""}`;
  if (input.releaseOffered) {
    const runs = prod.version === undefined ? "" : ` Production runs ${prod.version}.`;
    return {
      kind: "ready",
      label: `${count} ready`,
      tip: {
        title: "Review release",
        lines: [
          `${changesCountWords(input.waiting, input.waitingAtLeast)} on stage, not in production yet.${runs}`,
        ],
      },
    };
  }
  return {
    kind: "waiting",
    label: `${count} waiting`,
    tip: {
      title: `${count} waiting`,
      lines: [
        NEEDS_FIXING.has(prod.state)
          ? "The release waits until production is fixed"
          : "Releasing isn't offered to you here",
      ],
    },
  };
}
