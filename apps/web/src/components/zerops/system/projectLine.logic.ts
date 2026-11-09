/**
 * The line: where each of a project's changes is. Its shape is the project's setup alone — Mates'
 * work, `main`, the stage where it has one, production, and a side row for each further place or
 * copy that is not calm. Activity only moves beads along it and changes its counts: a change is one
 * bead in its Mate's tint, capped by the room its segment has, then a count.
 *
 * Read from what the project's page already reads: its flow (`GroupFlow`), its places
 * (`placeLines`), its changes (`pageChanges`), what waits on the viewer (`useViewerWaits`) and its
 * next release (`nextReleaseView`). Pure: no React, no clock.
 */
import {
  REVIEW_RELEASE_LABEL,
  type FlowPullRequest,
  type GroupFlow,
} from "@t3tools/client-runtime/zerops";
import type { MateTintId } from "@t3tools/shared/brand";

import {
  placeLabel,
  type CardChange,
  type CardReady,
  type PlaceLine,
} from "../projects/projectCard.logic";
import { changeRowLine } from "./ChangeRow.logic";
import type { NextReleaseView } from "./NextRelease.logic";
import { placeLineView } from "./PlaceLine.logic";

/** A word of the line: muted unless toned; a version in mono, a name in ink. */
export interface LineWord {
  readonly text: string;
  readonly tone?: "danger" | "info" | "warning" | "dim" | undefined;
  readonly mono?: true | undefined;
  readonly strong?: true | undefined;
}

/**
 * One change on the line. `waits`: on the viewer's review (a blue ring); `stuck`: conflicts or
 * failed checks, its Mate's to fix (amber); `work`: not a change yet (a dashed outline).
 */
export interface LineBead {
  readonly key: string;
  readonly tint: MateTintId | undefined;
  readonly mark: "waits" | "stuck" | "work" | undefined;
  readonly title: string;
  /** "Wren · Ready to merge": whose, and where it stands. */
  readonly line: string;
  /** The change it opens, as its row in the Changes list does; none for work not yet a change. */
  readonly pull: FlowPullRequest | undefined;
}

export interface LineStation {
  readonly kind: "mates" | "main" | "stage" | "production";
  readonly name: string;
  /** `live`: a place that runs something; `absent`: not live yet, a dashed ring. */
  readonly node: "solid" | "live" | "absent";
  readonly tone: "neutral" | "success" | "danger" | "info";
  /** Mates' work: its Mates' tints, five at most. */
  readonly tints: ReadonlyArray<MateTintId | undefined>;
  /** Under its name, one line each: its Mates, its repositories, a place's state. */
  readonly lines: ReadonlyArray<ReadonlyArray<LineWord>>;
  /** A place's page (`/group/$groupId/$projectId`); none for Mates' work and `main`. */
  readonly projectId: string | undefined;
  /** A place's address: a stage's under its state, production's under the track. */
  readonly address: { readonly host: string; readonly url: string } | undefined;
  /** What production runs, said under the track where the line is compact. */
  readonly version: string | undefined;
}

export type LineVerb =
  | { readonly kind: "review-change"; readonly label: string; readonly pull: FlowPullRequest }
  | { readonly kind: "review-release"; readonly label: string; readonly primary: boolean }
  | { readonly kind: "put-live"; readonly label: string };

/** What lies between two stations: the changes on their way from one to the next. */
export interface LineSegment {
  readonly key: "work" | "stage" | "release";
  /** `auto`: deploys by itself; `ready`: a release waits; `failed`; `none`: no production yet. */
  readonly track: "solid" | "auto" | "ready" | "failed" | "none";
  /** Farthest from the next station first: the ones that wait on the viewer stand nearest it. */
  readonly beads: ReadonlyArray<LineBead>;
  /** Changes counted here that have no bead of their own. */
  readonly more: number;
  readonly caption: ReadonlyArray<LineWord>;
  /** Its caption where the line is compact. */
  readonly short: ReadonlyArray<LineWord>;
  readonly verb: LineVerb | undefined;
  /** Its beads, named for assistive tech: "14 open changes, 3 wait on you". */
  readonly label: string;
  /** Its changes are not read yet: no bead and no count is said. */
  readonly held: boolean;
}

/** A further place or copy, hung under `main`: one line. */
export interface LineSide {
  readonly key: string;
  readonly words: ReadonlyArray<LineWord>;
  /** The place's page, where it is one. */
  readonly projectId: string | undefined;
}

export interface ProjectLineView {
  readonly stations: ReadonlyArray<LineStation>;
  /** One between each two stations, in order. */
  readonly segments: ReadonlyArray<LineSegment>;
  readonly sides: ReadonlyArray<LineSide>;
}

/** Work a Mate has that is not a change yet: uncommitted or unpushed. */
export interface LineWork {
  readonly key: string;
  readonly mateProjectId: string;
  readonly title: string;
  /** "2 files not committed". */
  readonly words: string;
}

/** A copy of the code elsewhere (GitHub) that is not calm: behind, pushing, unreachable. */
export interface LineCopy {
  readonly key: string;
  /** "GitHub". */
  readonly host: string;
  /** "acme/shop". */
  readonly name: string;
  readonly line: string;
  readonly tone: "warning" | "danger" | "info";
}

export interface ProjectLineInput {
  readonly flow: Pick<GroupFlow, "mates" | "production" | "stages">;
  /** Its places as lines (`placeLines`), each stage and production. */
  readonly places: ReadonlyArray<PlaceLine>;
  /** What a place's page is opened by (its environment); its line's project where not given. */
  readonly placeId?: ((line: PlaceLine) => string | undefined) | undefined;
  readonly tintOf: (mateProjectId: string) => MateTintId | undefined;
  /** Its code repositories, by name. */
  readonly repos: ReadonlyArray<string>;
  /** Its copies that are not calm; a copy in sync draws nothing. */
  readonly copies: ReadonlyArray<LineCopy>;
  /** Its changes, open and merged (`pageChanges`). */
  readonly changes: ReadonlyArray<CardChange>;
  /** Its changes are read: before that no bead and no count is said. */
  readonly changesKnown: boolean;
  /** The changes that wait for the viewer's review, by `lineChangeKey`. */
  readonly waiting: ReadonlySet<string>;
  readonly work?: ReadonlyArray<LineWork> | undefined;
  readonly release: {
    /** The next release as the page offers it (`nextReleaseView`); `none` where it offers none. */
    readonly view: NextReleaseView;
    /**
     * Why the last release did not go live, in the place page's own sentence
     * (`releaseNotCreatedWords`, "v0.1.5 didn't go live: db could not be created in production");
     * where none is told the segment says that it didn't.
     */
    readonly cause?: string | undefined;
    readonly ready: CardReady | undefined;
    /** Production's own note where no release is offered ("Waiting for its first release"). */
    readonly note?: string | undefined;
  };
  /** *Put it live*, where the project has no production and HQ offers one to this person. */
  readonly putLive: string | undefined;
  /** Places being set up that no line holds yet: each a side row. */
  readonly coming?: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly line: string;
  }>;
  /** One Mate's line: its beads in full, everybody else's as "+N from others". */
  readonly mine?: string | undefined;
}

/** A change by its repository and number. */
export const lineChangeKey = (pull: Pick<FlowPullRequest, "repository" | "number">) =>
  `${pull.repository}#${String(pull.number)}`;

/** A change that waits for the viewer's review, as its row and its bead say it. */
export const READY_FOR_REVIEW = "Ready for your review";

/**
 * A merged change that production does not run: on `main`, on the stage or on its way there, or in
 * a release that is not live (one that didn't go live, or was rolled back past).
 */
const notLive = (change: CardChange): boolean =>
  !change.open &&
  change.pull.kind === "code" &&
  change.where !== undefined &&
  change.where.kind !== "setup" &&
  (change.where.kind !== "released" || !change.where.live);

const SEP: LineWord = { text: " · " };
const between = (parts: ReadonlyArray<LineWord>): ReadonlyArray<LineWord> =>
  parts.flatMap((part, index) => (index === 0 ? [part] : [SEP, part]));
const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * The stage `main` feeds, which stands on the line as its Stage station: the one that follows
 * `main`, else one that runs something, else the first. A stage delivered to a branch is no
 * station: it hangs under `main` while it is behind.
 */
function stationStage(stages: GroupFlow["stages"]) {
  const own = stages.filter((stop) => stop.git === undefined);
  return (
    own.find((stop) => stop.source === "main") ??
    own.find((stop) => stop.state === "deployed") ??
    own[0]
  );
}

/** A place's state under its name: its not-calm word in its tone, else what it runs and since when. */
function placeWords(line: PlaceLine): ReadonlyArray<ReadonlyArray<LineWord>> {
  const view = placeLineView(line);
  const facts = view.facts.map((text): LineWord => ({ text }));
  if (view.pill !== undefined)
    return [
      [{ text: view.pill.word, tone: view.pill.tone === "danger" ? "danger" : "info" }],
      ...(facts.length === 0 ? [] : [between(facts)]),
    ];
  const runs: ReadonlyArray<LineWord> =
    view.version === undefined
      ? view.state === undefined
        ? []
        : [{ text: view.state }]
      : [{ text: view.version, mono: true }];
  const said = between([...runs, ...facts]);
  return said.length === 0 ? [] : [said];
}

function placeStation(
  kind: "stage" | "production",
  line: PlaceLine,
  projectId: string | undefined,
): LineStation {
  const view = placeLineView(line);
  return {
    kind,
    name: view.title,
    node: kind === "production" ? "live" : "solid",
    tone: view.tone,
    tints: [],
    lines: placeWords(line),
    projectId,
    address: view.address,
    version: view.version,
  };
}

/** The line of one project, from its setup and what is on its way. */
export function projectLine(input: ProjectLineInput): ProjectLineView {
  const { flow, mine } = input;
  const mateName = (projectId: string) =>
    flow.mates.find((mate) => mate.projectId === projectId)?.name;
  const owned = (projectId: string) => mine === undefined || projectId === mine;
  const placeId = (line: PlaceLine) =>
    input.placeId === undefined ? line.projectId : input.placeId(line);
  const beadOf = (change: CardChange, mark: LineBead["mark"]): LineBead => ({
    key: lineChangeKey(change.pull),
    tint: input.tintOf(change.pull.mateProjectId),
    mark,
    title: change.pull.title,
    line: changeRowLine(
      mateName(change.pull.mateProjectId),
      mark === "waits" ? READY_FOR_REVIEW : change.words,
    ),
    pull: change.pull,
  });
  const others = (changes: ReadonlyArray<{ readonly mateProjectId: string }>) =>
    changes.filter((change) => !owned(change.mateProjectId)).length;
  const fromOthers = (n: number): ReadonlyArray<LineWord> =>
    n === 0 ? [] : [{ text: `+${String(n)} from others`, tone: "dim" }];

  // Stations: the project's setup, and nothing else.
  const stageStop = stationStage(flow.stages);
  const stageLine =
    stageStop === undefined
      ? undefined
      : input.places.find(
          (line) => line.kind === "stage" && line.projectId === stageStop.projectId,
        );
  const productionLine = input.places.find((line) => line.kind === "production");
  const absent = flow.production.kind === "absent";
  const mates: LineStation = {
    kind: "mates",
    name: mine === undefined ? "Mates' work" : `${mateName(mine) ?? "This Mate"}'s work`,
    node: "solid",
    tone: "neutral",
    tints:
      mine === undefined ? flow.mates.slice(0, 5).map((mate) => input.tintOf(mate.projectId)) : [],
    lines:
      mine !== undefined
        ? []
        : [
            [
              {
                text:
                  flow.mates.length === 0
                    ? "No Mates yet"
                    : flow.mates.length <= 2
                      ? flow.mates.map((mate) => mate.name).join(", ")
                      : `${String(flow.mates.length)} Mates`,
              },
            ],
          ],
    projectId: undefined,
    address: undefined,
    version: undefined,
  };
  const main: LineStation = {
    kind: "main",
    name: "main",
    node: "solid",
    tone: "neutral",
    tints: [],
    lines: input.repos.length === 0 ? [] : [[{ text: input.repos.join(" · ") }]],
    projectId: undefined,
    address: undefined,
    version: undefined,
  };
  const production: LineStation =
    absent || productionLine === undefined
      ? {
          kind: "production",
          name: "Production",
          node: absent ? "absent" : "solid",
          tone: "neutral",
          tints: [],
          lines: absent ? [[{ text: "Not live yet" }]] : [],
          projectId: undefined,
          address: undefined,
          version: undefined,
        }
      : placeStation("production", productionLine, placeId(productionLine));
  const stage =
    stageLine === undefined ? undefined : placeStation("stage", stageLine, placeId(stageLine));

  // What is between them.
  const open = input.changes.filter((change) => change.open);
  const merged = input.changes.filter(notLive);
  const markOf = (change: CardChange): LineBead["mark"] =>
    input.waiting.has(lineChangeKey(change.pull))
      ? "waits"
      : change.tone === "attention" || change.tone === "failed"
        ? "stuck"
        : undefined;
  const rank = (mark: LineBead["mark"]) => (mark === "waits" ? 2 : mark === "stuck" ? 1 : 0);
  const opened = open
    .map((change) => beadOf(change, markOf(change)))
    // Newest first as listed: the newest that waits ends nearest the station.
    .toReversed()
    .toSorted((left, right) => rank(left.mark) - rank(right.mark));
  const mineOnly = (beads: ReadonlyArray<LineBead>) =>
    beads.filter((bead) => bead.pull === undefined || owned(bead.pull.mateProjectId));
  const working = (input.work ?? []).filter((work) => owned(work.mateProjectId));
  const workBeads: ReadonlyArray<LineBead> = [
    ...working.map((work): LineBead => ({
      key: `work:${work.key}`,
      tint: input.tintOf(work.mateProjectId),
      mark: "work",
      title: work.title,
      line: changeRowLine(mateName(work.mateProjectId), work.words),
      pull: undefined,
    })),
    ...mineOnly(opened),
  ];
  const waits = opened.filter((bead) => bead.mark === "waits").length;
  const stuck = opened.filter((bead) => bead.mark === "stuck").length;
  const next = mineOnly(opened).findLast((bead) => bead.mark === "waits")?.pull;
  const mineWaits = mineOnly(opened).filter((bead) => bead.mark === "waits").length;
  const openOthers = others(open.map((change) => change.pull));
  const workSegment: LineSegment = {
    key: "work",
    track: "solid",
    beads: input.changesKnown ? workBeads : [],
    more: 0,
    caption: !input.changesKnown
      ? []
      : mine !== undefined
        ? fromOthers(openOthers)
        : open.length === 0
          ? [{ text: "Nothing waits for review" }]
          : between([
              { text: `${String(open.length)} open` },
              ...(waits === 0
                ? []
                : [{ text: `${count(waits, "waits", "wait")} on you`, tone: "info" as const }]),
              ...(stuck === 0
                ? []
                : [{ text: `${String(stuck)} stuck`, tone: "warning" as const }]),
            ]),
    short: !input.changesKnown
      ? []
      : mine !== undefined
        ? fromOthers(openOthers)
        : waits > 0
          ? [{ text: `${count(waits, "waits", "wait")} on you`, tone: "info" }]
          : open.length > 0
            ? [{ text: `${String(open.length)} open` }]
            : [],
    verb:
      !input.changesKnown || next === undefined
        ? undefined
        : {
            kind: "review-change",
            label: mineWaits === 1 ? "Review" : "Review the next one",
            pull: next,
          },
    label: [
      open.length === 0 ? "No open changes" : count(open.length, "open change", "open changes"),
      ...(waits === 0 ? [] : [`${count(waits, "waits", "wait")} on you`]),
      ...(stuck === 0 ? [] : [`${String(stuck)} stuck`]),
      ...(working.length === 0 ? [] : [`${String(working.length)} not a change yet`]),
    ].join(", "),
    held: !input.changesKnown,
  };

  // On their way to the stage, where it has one; everything else merged waits for production.
  const deploying =
    stage === undefined
      ? []
      : merged.filter((change) => change.where?.kind === "deploying-to-stage");
  const ready = merged.filter((change) => !deploying.includes(change));
  const pulls = (changes: ReadonlyArray<CardChange>) => changes.map((change) => change.pull);
  const beadsOf = (changes: ReadonlyArray<CardChange>) =>
    mineOnly(changes.map((change) => beadOf(change, undefined)).toReversed());
  const stageFailed = stageLine?.dot === "failed" || stageLine?.dot === "down";
  const stageSegment: LineSegment | undefined =
    stage === undefined
      ? undefined
      : {
          key: "stage",
          // Dotted while it follows `main` by itself; drawn through while a deploy carries a change.
          track: stageFailed
            ? "failed"
            : input.changesKnown && deploying.length > 0
              ? "solid"
              : "auto",
          beads: input.changesKnown ? beadsOf(deploying) : [],
          more: 0,
          // A failed deploy is the stage's own word, said once on its station: here, the red track.
          caption: stageFailed
            ? []
            : deploying.length > 0 && input.changesKnown
              ? [
                  {
                    text:
                      deploying.length === 1
                        ? "1 on its way"
                        : `${String(deploying.length)} on their way`,
                    tone: "dim",
                  },
                ]
              : stageStop?.source === "main" && input.changesKnown
                ? [{ text: "deploys by itself", tone: "dim" }]
                : [],
          short: [],
          verb: undefined,
          label:
            deploying.length === 0
              ? `Nothing on its way to ${stage.name}`
              : `${count(deploying.length, "change", "changes")} on ${
                  deploying.length === 1 ? "its" : "their"
                } way to ${stage.name}`,
          held: !input.changesKnown,
        };

  const { view } = input.release;
  const readyMates = new Set(ready.map((change) => change.pull.mateProjectId)).size;
  const counted = input.release.ready;
  const readyWords = (): ReadonlyArray<LineWord> => {
    // Every change the release counts, the ones the page lists no row for too.
    const all = Math.max(ready.length, mine === undefined ? (counted?.changeCount ?? 0) : 0);
    if (ready.length > 0)
      return all === 1
        ? [{ text: "1 change ready" }]
        : between([
            { text: `${String(all)} ready` },
            ...(readyMates > 1 ? [{ text: `from ${String(readyMates)} Mates` }] : []),
          ]);
    // No change of its own is listed: what the release counts, commits where it counts no changes.
    if (counted === undefined) return [{ text: "Changes ready" }];
    const plus = counted.atLeast ? "+" : "";
    return counted.changeCount === undefined
      ? [
          {
            text: `${String(counted.count)}${plus} ${counted.count === 1 && !counted.atLeast ? "commit" : "commits"} ready`,
          },
        ]
      : [{ text: `${count(counted.changeCount, "change", "changes")} ready` }];
  };
  const readyOthers = others(pulls(ready));
  const settled = view.kind === "releasing" || view.kind === "failed";
  const releaseSegment: LineSegment = {
    key: "release",
    track: absent
      ? "none"
      : view.kind === "failed"
        ? "failed"
        : view.kind === "none"
          ? "solid"
          : "ready",
    beads: input.changesKnown ? beadsOf(ready) : [],
    // The release counts changes the page lists no row for: they stand as a count.
    more:
      input.changesKnown && !absent && view.kind !== "none" && mine === undefined
        ? Math.max(0, (counted?.changeCount ?? 0) - ready.length)
        : 0,
    caption:
      !input.changesKnown && !settled
        ? []
        : absent
          ? ready.length === 0
            ? []
            : [{ text: `${count(ready.length, "change", "changes")} on main` }]
          : view.kind === "releasing"
            ? [{ text: view.title, tone: "info" }]
            : view.kind === "failed"
              ? [{ text: input.release.cause ?? view.pill, tone: "danger" }]
              : view.kind === "ready"
                ? readyWords()
                : input.release.note !== undefined
                  ? [{ text: input.release.note }]
                  : ready.length === 0
                    ? []
                    : [{ text: `${count(ready.length, "waits", "wait")} for production` }],
    short: !input.changesKnown
      ? []
      : mine !== undefined
        ? fromOthers(readyOthers)
        : ready.length === 0
          ? []
          : [
              {
                text: absent ? `${String(ready.length)} on main` : `${String(ready.length)} ready`,
              },
            ],
    verb: absent
      ? input.putLive === undefined
        ? undefined
        : { kind: "put-live", label: input.putLive }
      : view.kind === "none"
        ? undefined
        : {
            kind: "review-release",
            label: view.kind === "releasing" ? view.verb : REVIEW_RELEASE_LABEL,
            primary: view.kind !== "releasing",
          },
    label: absent
      ? `${count(ready.length, "change", "changes")} on main`
      : `${count(ready.length, "change", "changes")} ready for production`,
    held: !input.changesKnown,
  };

  // Hung under `main`: each further place, and each copy that is not calm. One Mate's line is
  // about its own work: the project's other places stand on the project's page.
  const sides: ReadonlyArray<LineSide> =
    mine !== undefined
      ? []
      : [
          ...input.copies.map((copy): LineSide => ({
            key: `copy:${copy.key}`,
            words: [
              { text: `${copy.host} ` },
              { text: copy.name, strong: true },
              SEP,
              { text: copy.line, tone: copy.tone },
            ],
            projectId: undefined,
          })),
          ...input.places
            .filter((line) => line.kind === "stage" && line !== stageLine)
            // A place delivered to a branch says nothing while it follows.
            .filter((line) => line.git === undefined || line.dot !== "none")
            .map((line, index): LineSide => {
              const [first, ...rest] = line.words;
              const tone: LineWord["tone"] = line.trouble
                ? "danger"
                : line.dot === "releasing"
                  ? "info"
                  : undefined;
              return {
                key: `place:${line.projectId ?? `${line.name}:${String(index)}`}`,
                words: [
                  { text: placeLabel(line), strong: true },
                  ...(first === undefined ? [] : [SEP, { text: first, tone }]),
                  ...rest.flatMap((text) => [SEP, { text }]),
                ],
                projectId: placeId(line),
              };
            }),
          ...(input.coming ?? []).map((place): LineSide => ({
            key: `coming:${place.key}`,
            words: [{ text: place.name, strong: true }, SEP, { text: place.line }],
            projectId: undefined,
          })),
        ];

  return {
    stations: [mates, main, ...(stage === undefined ? [] : [stage]), production],
    segments: [workSegment, ...(stageSegment === undefined ? [] : [stageSegment]), releaseSegment],
    sides,
  };
}

/** A bead's side and the gap to the next, as the track lays them. */
export const BEAD_PITCH = 17;

/** The count's chip, as wide as its digits need. */
export const moreChipWidth = (more: number) => (more < 10 ? 28 : 34);

/**
 * The beads a segment has room for, packed toward its far station: past that, a count. `width` is
 * the distance between its two stations; a station's dot and the gap before the next take 38 px of
 * it. The beads nearest the next station stay.
 */
export function fitBeads<Bead>(
  beads: ReadonlyArray<Bead>,
  more: number,
  width: number,
): { readonly beads: ReadonlyArray<Bead>; readonly more: number } {
  const room = Math.max(0, Math.floor(width) - 38);
  let shown = beads.length;
  let rest = more;
  // The chip takes room from the beads, and may grow a digit as it counts them.
  for (let pass = 0; pass <= beads.length; pass += 1) {
    const chip = rest === 0 ? 0 : moreChipWidth(rest) + 6;
    const fits = Math.max(0, Math.floor((room - chip) / BEAD_PITCH));
    if (shown <= fits) break;
    rest = more + (beads.length - fits);
    shown = fits;
  }
  return { beads: beads.slice(beads.length - shown), more: rest };
}
