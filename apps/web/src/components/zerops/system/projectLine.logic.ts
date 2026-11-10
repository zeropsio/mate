/**
 * The line: a picture of where each of a project's changes is. Its shape is the project's setup
 * alone — Mates' work, `main`, the stage where it has one, production. Activity only moves beads
 * along it and changes its counts: a change is one bead in its Mate's tint, capped by the room its
 * segment has, then a count.
 *
 * It is a picture and nothing more: a place's state, its address, its vault and every verb are the
 * project's Places and the place's own page (the owner, 2026-11-10: "the visualisation shouldn't
 * replace prod/stages setup/navigation/state").
 *
 * Behind the picture stands the line in full (`projectLineFull`): the same stations, segments and
 * beads, with what each station is under its name (its Mates, its repositories, a place's state and
 * the way to its page) and a row under `main` for each further place. It reads the picture it
 * stands behind, so what the picture counts the full line counts.
 *
 * Read from what the project's page already reads: its flow (`GroupFlow`), its places
 * (`placeLines`), its changes (`pageChanges`), what waits on the viewer (`useViewerWaits`) and its
 * next release (`nextReleaseView`). Pure: no React, no clock.
 */
import type { FlowPullRequest, GroupFlow } from "@t3tools/client-runtime/zerops";
import type { MateTintId } from "@t3tools/shared/brand";

import {
  placeLabel,
  type CardChange,
  type CardReady,
  type PlaceLine,
} from "../projects/projectCard.logic";
import { changeRowLine } from "./ChangeRow.logic";
import { DIDNT_GO_LIVE, type NextReleaseView } from "./NextRelease.logic";
import { placeLineView } from "./PlaceLine.logic";

/** A word of the line: muted unless toned; in full, a version in mono and a name in ink. */
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
  /** `absent`: no production yet, a dashed ring. */
  readonly node: "solid" | "absent";
}

/** The group of the Changes list a segment's caption counts: its caption leads there. */
export type LineGroup = "open" | "deploying" | "ready";

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
  /** The Changes list's group its caption counts; none where it counts no change. */
  readonly group: LineGroup | undefined;
  /** Its beads, named for assistive tech: "14 open changes, 3 wait on you". */
  readonly label: string;
  /** Its changes are not read yet: no bead and no count is said. */
  readonly held: boolean;
}

export interface ProjectLineView {
  readonly stations: ReadonlyArray<LineStation>;
  /** One between each two stations, in order. */
  readonly segments: ReadonlyArray<LineSegment>;
}

/** Work a Mate has that is not a change yet: uncommitted or unpushed. */
export interface LineWork {
  readonly key: string;
  readonly mateProjectId: string;
  readonly title: string;
  /** "Not a change yet". */
  readonly words: string;
}

export interface ProjectLineInput {
  readonly flow: Pick<GroupFlow, "mates" | "production" | "stages">;
  /** Its places as lines (`placeLines`): the stage's name, and whether its deploy failed. */
  readonly places: ReadonlyArray<PlaceLine>;
  readonly tintOf: (mateProjectId: string) => MateTintId | undefined;
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
    readonly ready: CardReady | undefined;
  };
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

/**
 * The merged changes production does not run yet, newest first as the page lists them. While a
 * release is on its way production's commits answer to no release, so none reads live and every
 * released change would stand before production: then only the newest release's are on their way,
 * and what earlier releases took, production runs.
 */
function mergedNotLive(changes: ReadonlyArray<CardChange>): ReadonlyArray<CardChange> {
  const waiting = changes.filter(notLive);
  if (changes.some((change) => change.where?.kind === "released" && change.where.live)) {
    return waiting;
  }
  const newest = waiting.find((change) => change.where?.kind === "released")?.where;
  const tag = newest?.kind === "released" ? newest.tag : undefined;
  return waiting.filter((change) => change.where?.kind !== "released" || change.where.tag === tag);
}

const SEP: LineWord = { text: " · " };
const between = (parts: ReadonlyArray<LineWord>): ReadonlyArray<LineWord> =>
  parts.flatMap((part, index) => (index === 0 ? [part] : [SEP, part]));
const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * The stage `main` feeds, which stands on the line as its Stage station: the one that follows
 * `main`, else one that runs something, else the first. A stage delivered to a branch is no
 * station of the line.
 */
function stationStage(stages: GroupFlow["stages"]) {
  const own = stages.filter((stop) => stop.git === undefined);
  return (
    own.find((stop) => stop.source === "main") ??
    own.find((stop) => stop.state === "deployed") ??
    own[0]
  );
}

/** The stage that stands on the line, and its line among the project's places. */
function lineStage(input: Pick<ProjectLineInput, "flow" | "places">) {
  const stop = stationStage(input.flow.stages);
  const line =
    stop === undefined
      ? undefined
      : input.places.find((each) => each.kind === "stage" && each.projectId === stop.projectId);
  return { stop, line };
}

/** The line of one project, from its setup and what is on its way. */
export function projectLine(input: ProjectLineInput): ProjectLineView {
  const { flow, mine } = input;
  const mateName = (projectId: string) =>
    flow.mates.find((mate) => mate.projectId === projectId)?.name;
  const owned = (projectId: string) => mine === undefined || projectId === mine;
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
  const { stop: stageStop, line: stageLine } = lineStage(input);
  const absent = flow.production.kind === "absent";
  const stageName = stageLine === undefined ? undefined : placeLabel(stageLine);
  const stations: ReadonlyArray<LineStation> = [
    {
      kind: "mates",
      name: mine === undefined ? "Mates' work" : `${mateName(mine) ?? "This Mate"}'s work`,
      node: "solid",
    },
    { kind: "main", name: "main", node: "solid" },
    ...(stageName === undefined
      ? []
      : [{ kind: "stage" as const, name: stageName, node: "solid" as const }]),
    { kind: "production", name: "Production", node: absent ? "absent" : "solid" },
  ];

  // What is between them.
  const open = input.changes.filter((change) => change.open);
  const merged = mergedNotLive(input.changes);
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
  const openOthers = others(open.map((change) => change.pull));
  const waitsWords: LineWord = { text: `${count(waits, "waits", "wait")} on you`, tone: "info" };
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
              ...(waits === 0 ? [] : [waitsWords]),
              ...(stuck === 0
                ? []
                : [{ text: `${String(stuck)} stuck`, tone: "warning" as const }]),
            ]),
    short: !input.changesKnown
      ? []
      : mine !== undefined
        ? fromOthers(openOthers)
        : waits > 0
          ? [waitsWords]
          : open.length > 0
            ? [{ text: `${String(open.length)} open` }]
            : [],
    group: mine === undefined && open.length > 0 ? "open" : undefined,
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
    stageName === undefined
      ? []
      : merged.filter((change) => change.where?.kind === "deploying-to-stage");
  const ready = merged.filter((change) => !deploying.includes(change));
  const beadsOf = (changes: ReadonlyArray<CardChange>) =>
    mineOnly(changes.map((change) => beadOf(change, undefined)).toReversed());
  const stageFailed = stageLine?.dot === "failed" || stageLine?.dot === "down";
  const carrying = input.changesKnown && deploying.length > 0;
  const stageSegment: LineSegment | undefined =
    stageName === undefined
      ? undefined
      : {
          key: "stage",
          // Dotted while it follows `main` by itself; drawn through while a deploy carries a change.
          track: stageFailed ? "failed" : carrying ? "solid" : "auto",
          beads: input.changesKnown ? beadsOf(deploying) : [],
          more: 0,
          // Why it failed is the stage's own line, in Places and on its page.
          caption: stageFailed
            ? [
                {
                  text: (stageLine?.words[0] ?? "Deploy failed").toLocaleLowerCase(),
                  tone: "danger",
                },
              ]
            : carrying
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
          group: carrying && !stageFailed && mine === undefined ? "deploying" : undefined,
          label:
            deploying.length === 0
              ? `Nothing on its way to ${stageName}`
              : `${count(deploying.length, "change", "changes")} on ${
                  deploying.length === 1 ? "its" : "their"
                } way to ${stageName}`,
          held: !input.changesKnown,
        };

  const { view } = input.release;
  const readyMates = new Set(ready.map((change) => change.pull.mateProjectId)).size;
  const counted = input.release.ready;
  const offered = !absent && view.kind !== "none";
  // Every change the release counts, the ones the page lists no row for too.
  const all = Math.max(
    ready.length,
    offered && mine === undefined ? (counted?.changeCount ?? 0) : 0,
  );
  const readyWords = (): ReadonlyArray<LineWord> => {
    if (ready.length > 0)
      return all === 1
        ? [{ text: "1 change ready" }]
        : between([
            { text: `${String(all)} ready` },
            ...(readyMates > 1 ? [{ text: `from ${String(readyMates)} Mates` }] : []),
          ]);
    // No change of its own is listed: what the release counts, commits where it counts no changes.
    if (counted === undefined) return [];
    const plus = counted.atLeast ? "+" : "";
    return counted.changeCount === undefined
      ? [
          {
            text: `${String(counted.count)}${plus} ${counted.count === 1 && !counted.atLeast ? "commit" : "commits"} ready`,
          },
        ]
      : [{ text: `${count(counted.changeCount, "change", "changes")} ready` }];
  };
  const readyOthers = others(ready.map((change) => change.pull));
  const releaseCaption = (): ReadonlyArray<LineWord> => {
    if (absent)
      return ready.length === 0
        ? []
        : [{ text: `${count(ready.length, "change", "changes")} on main` }];
    switch (view.kind) {
      case "releasing":
        return [{ text: view.title, tone: "info" }];
      // Why is production's own line, in Places and on its page: here, that it didn't.
      case "failed":
        return between([
          ...readyWords(),
          { text: DIDNT_GO_LIVE.toLocaleLowerCase(), tone: "danger" },
        ]);
      case "ready":
        return readyWords();
      case "none":
        return ready.length === 0
          ? []
          : [{ text: `${count(ready.length, "waits", "wait")} for production` }];
    }
  };
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
    more: input.changesKnown ? all - ready.length : 0,
    caption: !input.changesKnown
      ? []
      : mine !== undefined
        ? fromOthers(readyOthers)
        : releaseCaption(),
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
    group: mine === undefined && ready.length > 0 ? "ready" : undefined,
    label: absent
      ? `${count(ready.length, "change", "changes")} on main`
      : `${count(ready.length, "change", "changes")} ready for production`,
    held: !input.changesKnown,
  };

  return {
    stations,
    segments: [workSegment, ...(stageSegment === undefined ? [] : [stageSegment]), releaseSegment],
  };
}

/** A station of the line in full: what it is under its name, and the page it leads to. */
export interface LineStationFull {
  readonly kind: LineStation["kind"];
  readonly name: string;
  /** `live`: a place that runs something; `absent`: not live yet, a dashed ring. */
  readonly node: "solid" | "live" | "absent";
  readonly tone: "neutral" | "success" | "danger" | "info";
  /** Mates' work: its Mates' tints, five at most, each by its Mate. */
  readonly tints: ReadonlyArray<{ readonly key: string; readonly tint: MateTintId | undefined }>;
  /** Under its name, one line each: its Mates, its repositories, a place's state. */
  readonly lines: ReadonlyArray<ReadonlyArray<LineWord>>;
  /** A place's page (`/group/$groupId/$projectId`); none for Mates' work and `main`. */
  readonly projectId: string | undefined;
  /** What production runs, said under the track where the line is compact. */
  readonly version: string | undefined;
}

/** A further place, hung under `main`: one line. */
export interface LineSide {
  readonly key: string;
  readonly words: ReadonlyArray<LineWord>;
  /** The place's page, where it is one. */
  readonly projectId: string | undefined;
}

export interface ProjectLineFullView {
  readonly stations: ReadonlyArray<LineStationFull>;
  /** The picture's segments: its beads, its counts. */
  readonly segments: ReadonlyArray<LineSegment>;
  readonly sides: ReadonlyArray<LineSide>;
}

/** What the line in full reads beyond its picture. Never one Mate's (`mine`). */
export interface ProjectLineFullInput extends Omit<ProjectLineInput, "mine" | "work"> {
  /** What a place's page is opened by (its environment); its line's project where not given. */
  readonly placeId?: ((line: PlaceLine) => string | undefined) | undefined;
  /** Its code repositories, by name. */
  readonly repos: ReadonlyArray<string>;
  /** Places being set up that no line holds yet: each a side row. */
  readonly coming?: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly line: string;
  }>;
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

/**
 * The line in full, behind its picture (`picture`, `projectLine` of the same input): the picture's
 * stations with what each is, its segments as it counts them, and the project's further places.
 */
export function projectLineFull(
  input: ProjectLineFullInput,
  picture: ProjectLineView = projectLine(input),
): ProjectLineFullView {
  const { flow } = input;
  const placeId = (line: PlaceLine) =>
    input.placeId === undefined ? line.projectId : input.placeId(line);
  const { line: stageLine } = lineStage(input);
  const productionLine = input.places.find((line) => line.kind === "production");
  const absent = flow.production.kind === "absent";
  const plain = { tone: "neutral", tints: [], projectId: undefined, version: undefined } as const;
  const stations = picture.stations.map((station): LineStationFull => {
    const place =
      station.kind === "stage"
        ? stageLine
        : station.kind === "production" && !absent
          ? productionLine
          : undefined;
    if (place !== undefined) {
      const view = placeLineView(place);
      return {
        kind: station.kind,
        name: station.name,
        node: station.kind === "production" ? "live" : "solid",
        tone: view.tone,
        tints: [],
        lines: placeWords(place),
        projectId: placeId(place),
        version: view.version,
      };
    }
    switch (station.kind) {
      case "mates":
        return {
          ...plain,
          kind: station.kind,
          name: station.name,
          node: "solid",
          tints: flow.mates
            .slice(0, 5)
            .map((mate) => ({ key: mate.projectId, tint: input.tintOf(mate.projectId) })),
          lines: [
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
        };
      case "main":
        return {
          ...plain,
          kind: station.kind,
          name: station.name,
          node: "solid",
          lines: input.repos.length === 0 ? [] : [[{ text: input.repos.join(" · ") }]],
        };
      case "stage":
      case "production":
        return {
          ...plain,
          kind: station.kind,
          name: station.name,
          node: station.node,
          lines: absent && station.kind === "production" ? [[{ text: "Not live yet" }]] : [],
        };
    }
  });

  // What failed is its place's own word, said once on its station: before it the track is red, and
  // its count keeps what it counts.
  const segments = picture.segments.map((segment, at) => {
    const next = stations[at + 1];
    if (segment.track !== "failed" || next === undefined || next.tone !== "danger") return segment;
    const calm = segment.caption.filter((word) => word.tone !== "danger");
    return { ...segment, caption: calm.at(-1) === SEP ? calm.slice(0, -1) : calm };
  });

  // Hung under `main`: each further place.
  const sides: ReadonlyArray<LineSide> = [
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

  return { stations, segments, sides };
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
