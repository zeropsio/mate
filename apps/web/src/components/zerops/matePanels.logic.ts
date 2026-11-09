/**
 * What a Mate's Zerops and Git panels say about where its work stands and where it goes, in the
 * words the project's pages use (the pages pass, 2026-11-09: "Nothing is stopping it" and "No code
 * here yet" were the panel's own phrases).
 *
 * Pure: the panels' containers read, this words, the panels draw.
 */
import {
  ENVIRONMENT_NOT_ADDED,
  type FlowPullRequest,
  type GitBlock,
} from "@t3tools/client-runtime/zerops";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { cardChanges, type PlaceLine } from "./projects/projectCard.logic";
import { applicationStage, openChangeWords } from "./system";

/** One row of a repository's work, as a change row draws it. */
export type GitWorkRow =
  /** HQ has not told the changes: the row's place is held, never filled with a guess. */
  | { readonly kind: "held" }
  /** The Mate's change: its title, then where it stands. */
  | {
      readonly kind: "change";
      readonly pull: FlowPullRequest;
      readonly state: string;
      readonly tone: ServiceStatusToneId;
      readonly open: boolean;
      readonly at: string | undefined;
    }
  /** Work that is no change yet, or a repository that could not be read: one plain sentence. */
  | { readonly kind: "plain"; readonly title: string; readonly tone: ServiceStatusToneId };

/** "1 file not committed yet" — the container's own fact, which outranks a calm state. */
export function uncommittedWords(count: number): string {
  return `${String(count)} ${count === 1 ? "file" : "files"} not committed yet`;
}

/** Block states that say nothing a person must act on: work on disk is the fresher news. */
const CALM = new Set<GitBlock["state"]>(["untouched", "unpushed", "in-review"]);

/**
 * A repository's work as rows. With no change, the one sentence `gitTab.ts` gives its state — or,
 * where its state is calm, what waits on disk. An open change under review says where it stands,
 * or what of its work is not committed or pushed yet. A landed change says where it went in the
 * project's own words (`landedWords`, "Merged · waits for production"), under a row for each kind
 * of new work since — files on disk, commits not pushed — or for what was proved wrong. A change
 * whose checkout no longer reads as a repository is drawn as it stands, never as one under review.
 */
export function gitWorkRows(
  block: GitBlock,
  change:
    | {
        readonly pull: FlowPullRequest;
        /** Where a landed change went, as the project's change rows say it. */
        readonly landedWords: string | undefined;
      }
    | undefined,
): ReadonlyArray<GitWorkRow> {
  const verdict = block.verdict;
  if (verdict === undefined) return [{ kind: "held" }];
  const troubled = block.trouble.length > 0;
  const uncommitted = block.changed.length;
  const onDisk =
    uncommitted > 0 && !troubled && verdict.tone !== "attention"
      ? uncommittedWords(uncommitted)
      : undefined;
  const unpushed = troubled ? undefined : block.unpushed;
  if (change === undefined || block.state === "unreadable")
    return [
      {
        kind: "plain",
        title: onDisk !== undefined && CALM.has(block.state) ? onDisk : verdict.text,
        tone: onDisk !== undefined && CALM.has(block.state) ? "busy" : verdict.tone,
      },
    ];
  const { pull } = change;
  if (block.state === "in-review") {
    // Fresher news than a calm review: work on disk, then commits the change does not have yet.
    const fresher = verdict.tone === "attention" ? undefined : (onDisk ?? unpushed);
    return [
      {
        kind: "change",
        pull,
        state: fresher ?? verdict.text,
        tone: fresher === undefined ? verdict.tone : "busy",
        open: true,
        at: pull.updatedAt,
      },
    ];
  }
  const since: ReadonlyArray<GitWorkRow> = troubled
    ? [{ kind: "plain", title: verdict.text, tone: verdict.tone }]
    : [
        ...(onDisk === undefined
          ? []
          : [{ kind: "plain" as const, title: onDisk, tone: "busy" as const }]),
        ...(unpushed === undefined
          ? []
          : [{ kind: "plain" as const, title: unpushed, tone: "busy" as const }]),
      ];
  if (pull.merged)
    return [
      ...since,
      {
        kind: "change",
        pull,
        state: change.landedWords ?? "Merged",
        tone: "off",
        open: false,
        at: pull.mergedAt ?? pull.updatedAt,
      },
    ];
  // Still open, but the checkout says nothing of a review (it is no repository now): the change as
  // HQ tells it — its review is still the way to it — under what was proved wrong, if anything.
  const open = openChangeWords(pull);
  return [
    ...(troubled ? since : []),
    { kind: "change", pull, state: open.words, tone: open.tone, open: true, at: pull.updatedAt },
  ];
}

/** "Dana's services", "Acme Notes' page": a name's own thing, as English writes it. */
export function possessive(name: string, thing: string): string {
  return `${name}${/s$/iu.test(name) ? "'" : "'s"} ${thing}`;
}

/**
 * The places a panel lists, with a line where a stage would stand when the project has none. The
 * Zerops panel lists production first, as the project's pages do, and says a missing stage is not
 * added; the Git panel lists them in the order the work travels and says what a missing stage means
 * for it: it goes to production through a release.
 */
export function panelPlaces(
  places: ReadonlyArray<PlaceLine>,
  panel: "zerops" | "git",
): ReadonlyArray<PlaceLine> {
  const stages = places.filter((line) => line.kind === "stage");
  const production = places.filter((line) => line.kind === "production");
  // No production either: nothing goes anywhere yet, and production's own line says so.
  const released = production.some((line) => line.words[0] !== ENVIRONMENT_NOT_ADDED);
  const shown: ReadonlyArray<PlaceLine> =
    stages.length > 0
      ? stages
      : [
          {
            kind: "stage",
            name: "stage",
            projectId: undefined,
            addresses: [],
            dot: "none",
            words: [
              panel === "git" && released
                ? "None · changes go to production through a release"
                : ENVIRONMENT_NOT_ADDED,
            ],
            trouble: false,
            nothingDeployed: true,
          },
        ];
  return panel === "git" ? [...shown, ...production] : [...production, ...shown];
}

/**
 * Where a landed change went, in the words the project's change rows say it (`cardChanges`): in a
 * release, on stage, or merged and not released yet. `undefined` where the project's flow does not
 * list it.
 */
export function landedChangeWords(
  flow: ZeropsProjectFlow,
  change: FlowPullRequest,
): string | undefined {
  const stage = applicationStage(flow)?.stage;
  return cardChanges({
    open: [],
    merged: flow.merged,
    releases: flow.releasesKnown ? flow.releases : [],
    stage,
    production: flow.environments.some((entry) => entry.tier === "production"),
    limit: flow.merged.length,
  }).find((row) => row.pull.repository === change.repository && row.pull.number === change.number)
    ?.words;
}
