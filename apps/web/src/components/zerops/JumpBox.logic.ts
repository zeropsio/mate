/**
 * The jump box's reading of the left menu: what a query finds, in which
 * groups, and what writing to a Mate from here does.
 *
 * The menu publishes what it holds (`sidebarJump.ts`) — its Mates, projects,
 * changes and stops, in its own order and its own scope — so the box finds
 * what the menu shows and nothing the menu hides. Words inside conversations
 * are what the menu already says of each Mate (the task it is on, its last
 * words) and then the server's search of every conversation's history
 * (`useThreadSearch`), each hit put under the Mate whose conversation it is.
 *
 * Typing `@` turns the box from finding to writing: it lists the Mates by
 * name, the free ones first, and once one is picked, what is typed goes to
 * that Mate. A Mate the viewer may not write to (D6) is not offered. When the
 * Mate reads it and what Enter does are `jumpWritePlan`'s — one line a person
 * reads before sending, and the action that line promises.
 *
 * Pure: no React, no clock, no store.
 */
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { MatePoseFacts } from "@t3tools/client-runtime/zerops";
import { maskSecrets, messageWords } from "@t3tools/shared/messagePreview";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

import { mateFaceOf, type ZeropsAgentActivity } from "~/zerops/agentActivity";

import type { MateDecision } from "./mateDecision.logic";
import type { ChipDot } from "./SidebarProductionChip.logic";

/** Where a Mate's conversation stands, for writing to it. */
export interface JumpConversation {
  readonly threadId: string;
  /** The one resolver's kind for it (R5). */
  readonly kind: ThreadStatusKind;
}

/** A Mate as its row in the menu shows it. */
export interface JumpMate {
  /** Its Zerops project: the row's key in the menu. */
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  /** The shape its person picked, else its tint's own (`mateShapeOf`). */
  readonly shape: MateShapeId;
  readonly face: MateMarkState;
  /** Its project's name; nothing for a Mate no project groups. */
  readonly projectName: string | undefined;
  /** The row's second line: the step it is on, or the task. */
  readonly subject: string | undefined;
  /** Its last words, as the row quotes them. */
  readonly snippet: string | undefined;
  readonly environmentId: string | undefined;
  /** Its container is connected, so what it is doing is known. */
  readonly connected: boolean;
  /** Its conversation, where it is connected and has one. */
  readonly conversation: JumpConversation | undefined;
  readonly owner: { readonly name: string; readonly isViewer: boolean } | undefined;
  /** When the usage limit pausing it resets; absent while it is not paused. */
  readonly pausedUntil: string | undefined;
  readonly usageLimited?: boolean | undefined;
  /** Its own change waits for the person's review (`mateReviewWaits`): it needs them. */
  readonly reviewWaits?: boolean;
  /** The viewer's own Mate (HQ's `waitsOnViewer`): only then does what it waits on need them. */
  readonly mine: boolean;
  /** Where it is in its life, as its row reads it (`mateFaceFor`): settled where absent. */
  readonly pose?: MatePoseFacts | undefined;
}

export interface JumpProject {
  readonly groupId: string;
  readonly name: string;
  /** How many of its Mates the menu shows. */
  readonly mates: number;
}

export interface JumpChange {
  /** `repository#number`, as the menu keys the change's row. */
  readonly key: string;
  readonly groupId: string;
  readonly repository: string;
  readonly number: number;
  readonly projectName: string | undefined;
  /** What the menu calls it (`sidebarChangeLabel`). */
  readonly label: string;
  /** The Mate whose change it is. */
  readonly mateProjectId: string;
  /** The Mate's name, where the menu knows it. */
  readonly whose: string | undefined;
}

export interface JumpStop {
  /** The stop's own Zerops project. */
  readonly projectId: string;
  readonly groupId: string;
  /** Its name under its project (`projectNameInApp`): `production`, of `Shop - production`. */
  readonly title: string;
  /** The project it belongs to: found by it too. */
  readonly projectName: string;
  /** What it runs. */
  readonly line: string;
  /** The dot its chip's menu wears for it: production's, or the stage's own. */
  readonly dot: ChipDot;
  /** Where it stands, in words: the dot's accessible name. */
  readonly word: string;
}

/** Everything the menu holds, in its own order. */
export interface SidebarJumpIndex {
  readonly mates: ReadonlyArray<JumpMate>;
  readonly projects: ReadonlyArray<JumpProject>;
  readonly changes: ReadonlyArray<JumpChange>;
  readonly stops: ReadonlyArray<JumpStop>;
}

export const EMPTY_JUMP_INDEX: SidebarJumpIndex = {
  mates: [],
  projects: [],
  changes: [],
  stops: [],
};

/** What the menu's row of a Mate says of its conversation (`agentActivity.ts`). */
export type JumpActivity = Pick<
  ZeropsAgentActivity,
  | "threadId"
  | "kind"
  | "face"
  | "subject"
  | "snippet"
  | "pausedUntil"
  | "usageLimited"
  | "remembered"
>;

/**
 * A Mate as the box lists it, from what its row knows: the face its row
 * wears (`mateFaceOf`, its review waiting included), and what it is on only while a word of now
 * says it — HQ's live word, or its connected container's — the row's own rule, so the two never
 * say two things. Its conversation is offered to write to only through its connected container.
 */
export function jumpMateOf(input: {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
  readonly projectName: string | undefined;
  readonly environmentId: string | undefined;
  readonly owner: JumpMate["owner"];
  readonly connected: boolean;
  /**
   * Its container runs (`candidateContainerRuns`): the face wears it awake while this browser's
   * socket to it opens, as its row does. Absent, the face follows `connected`.
   */
  readonly runs?: boolean | undefined;
  readonly activity: JumpActivity | undefined;
  readonly reviewWaits?: boolean | undefined;
  readonly mine: boolean;
  readonly pose?: MatePoseFacts | undefined;
}): JumpMate {
  const live = input.activity?.remembered === true ? undefined : input.activity;
  return {
    projectId: input.projectId,
    name: input.name,
    tint: input.tint,
    shape: input.shape,
    face: mateFaceOf({
      connected: input.connected || input.runs === true,
      activity: live,
      reviewWaits: input.reviewWaits === true,
      mine: input.mine,
      pose: input.pose,
    }),
    projectName: input.projectName,
    subject: live?.subject,
    snippet: live?.snippet,
    environmentId: input.environmentId,
    connected: input.connected,
    conversation:
      live === undefined || !input.connected
        ? undefined
        : { threadId: live.threadId, kind: live.kind },
    owner: input.owner,
    pausedUntil: live?.pausedUntil,
    usageLimited: live?.usageLimited,
    mine: input.mine,
    ...(input.reviewWaits === true ? { reviewWaits: true } : {}),
    ...(input.pose === undefined ? {} : { pose: input.pose }),
  };
}

/**
 * The index with every Mate's conversation read afresh. The menu publishes
 * what it drew; a phone's menu is put away while the box is open, and what a
 * Mate is doing moves on without it.
 */
export function withLiveMates(
  index: SidebarJumpIndex,
  activityOf: (mate: JumpMate) => JumpActivity | undefined,
): SidebarJumpIndex {
  return {
    ...index,
    mates: index.mates.map((mate) => jumpMateOf({ ...mate, activity: activityOf(mate) })),
  };
}

/** Words the server found inside a conversation. */
export interface JumpHit {
  readonly environmentId: string;
  readonly threadId: string;
  readonly source: "user" | "assistant";
  readonly snippet: string;
}

export type JumpQuery =
  | { readonly mode: "find"; readonly text: string }
  | { readonly mode: "write"; readonly name: string };

/** `@` writes to a Mate; anything else finds. */
export function readJumpQuery(value: string): JumpQuery {
  if (value.startsWith("@")) return { mode: "write", name: value.slice(1).trim() };
  return { mode: "find", text: value.trim() };
}

export type JumpItem =
  | { readonly kind: "mate"; readonly value: string; readonly mate: JumpMate }
  | { readonly kind: "write"; readonly value: string; readonly mate: JumpMate }
  | { readonly kind: "project"; readonly value: string; readonly project: JumpProject }
  | { readonly kind: "change"; readonly value: string; readonly change: JumpChange }
  | { readonly kind: "stop"; readonly value: string; readonly stop: JumpStop }
  /** Starting a project: the projects' last item, as it is the menu's last row (D11). */
  | { readonly kind: "new-project"; readonly value: "new-project" }
  | {
      readonly kind: "text";
      readonly value: string;
      readonly mate: JumpMate;
      readonly snippet: string;
    };

export interface JumpGroup {
  readonly id: string;
  readonly label: string;
  /** The words to mark in each item: what was typed. */
  readonly match: string;
  readonly items: ReadonlyArray<JumpItem>;
}

/** How many of each a group lists: one kind of thing never pushes the rest out of sight. */
export const JUMP_LIMITS = {
  /** Before anything is typed. */
  firstMates: 6,
  mates: 5,
  projects: 4,
  changes: 4,
  stops: 4,
  conversations: 5,
} as const;

const fold = (text: string) => text.toLocaleLowerCase();

function contains(text: string, query: string): boolean {
  return fold(text).includes(fold(query));
}

/** The ones whose name starts with the query first, the menu's order kept otherwise. */
function startsFirst<T>(items: ReadonlyArray<T>, nameOf: (item: T) => string, query: string) {
  const q = fold(query);
  return [
    ...items.filter((item) => fold(nameOf(item)).startsWith(q)),
    ...items.filter((item) => !fold(nameOf(item)).startsWith(q)),
  ];
}

/** Free to start on something now: not at work, not paused, not waiting on anybody. */
export function isFreeMate(mate: Pick<JumpMate, "face" | "pausedUntil">): boolean {
  return (mate.face === "idle" || mate.face === "done") && mate.pausedUntil === undefined;
}

const group = (
  id: string,
  label: string,
  match: string,
  items: ReadonlyArray<JumpItem>,
): ReadonlyArray<JumpGroup> => (items.length === 0 ? [] : [{ id, label, match, items }]);

const mateItem = (mate: JumpMate): JumpItem => ({
  kind: "mate",
  value: `mate:${mate.projectId}`,
  mate,
});
const writeItem = (mate: JumpMate): JumpItem => ({
  kind: "write",
  value: `write:${mate.projectId}`,
  mate,
});
const projectItem = (project: JumpProject): JumpItem => ({
  kind: "project",
  value: `project:${project.groupId}`,
  project,
});

const NOBODY: ReadonlySet<string> = new Set();

/** What the new-project item is found by, and says. */
export const NEW_PROJECT_LABEL = "New project";
const NEW_PROJECT_ITEM: JumpItem = { kind: "new-project", value: "new-project" };

/**
 * What the box lists for what was typed, group by group. `readOnly` holds the
 * Mates the viewer may not write to (D6): writing never offers them.
 */
export function jumpGroups(
  index: SidebarJumpIndex,
  value: string,
  hits: ReadonlyArray<JumpHit>,
  readOnly: ReadonlySet<string> = NOBODY,
): ReadonlyArray<JumpGroup> {
  const query = readJumpQuery(value);
  if (query.mode === "write") {
    const named = startsFirst(
      index.mates.filter(
        (mate) => !readOnly.has(mate.projectId) && contains(mate.name, query.name),
      ),
      (mate) => mate.name,
      query.name,
    );
    return [
      ...group("free", "Free now", query.name, named.filter(isFreeMate).map(writeItem)),
      ...group(
        "busy",
        "Busy",
        query.name,
        named.filter((mate) => !isFreeMate(mate)).map(writeItem),
      ),
    ];
  }
  const text = query.text;
  if (text.length === 0) {
    return [
      ...group("mates", "Mates", "", index.mates.slice(0, JUMP_LIMITS.firstMates).map(mateItem)),
      ...group("projects", "Projects", "", [...index.projects.map(projectItem), NEW_PROJECT_ITEM]),
    ];
  }
  // A Mate is found by its own name and by its project's: it is named in full there.
  const mates = startsFirst(
    index.mates.filter((mate) => contains(`${mate.projectName ?? ""} ${mate.name}`, text)),
    (mate) => mate.name,
    text,
  ).slice(0, JUMP_LIMITS.mates);
  const projects = index.projects
    .filter((project) => contains(project.name, text))
    .slice(0, JUMP_LIMITS.projects);
  const changes = index.changes
    .filter((change) => contains(change.label, text))
    .slice(0, JUMP_LIMITS.changes);
  const stops = index.stops
    .filter((stop) => contains(`${stop.projectName} ${stop.title} ${stop.line}`, text))
    .slice(0, JUMP_LIMITS.stops);
  return [
    ...group("mates", "Mates", text, mates.map(mateItem)),
    ...group("projects", "Projects", text, [
      ...projects.map(projectItem),
      ...(contains(NEW_PROJECT_LABEL, text) ? [NEW_PROJECT_ITEM] : []),
    ]),
    ...group(
      "changes",
      "Changes",
      text,
      changes.map((change) => ({
        kind: "change" as const,
        value: `change:${change.groupId}:${change.key}`,
        change,
      })),
    ),
    ...group(
      "stops",
      "Stops",
      text,
      stops.map((stop) => ({ kind: "stop" as const, value: `stop:${stop.projectId}`, stop })),
    ),
    ...group("conversations", "In conversations", text, saidIn(index, text, hits)),
  ];
}

/**
 * The Mates whose conversations hold the words, once each: first what the
 * menu already says of them — the task, the last words — in its own order, so
 * they are there as the words are typed; then what the server found further
 * back, as it answers. The group only ever grows at its end.
 */
function saidIn(
  index: SidebarJumpIndex,
  text: string,
  hits: ReadonlyArray<JumpHit>,
): ReadonlyArray<JumpItem> {
  const said = new Map<string, JumpItem>();
  const add = (mate: JumpMate, words: string, where: string) => {
    if (said.has(mate.projectId)) return;
    said.set(mate.projectId, {
      kind: "text",
      value: `text:${mate.projectId}:${where}`,
      mate,
      snippet: snippetAround(words, text),
    });
  };
  for (const mate of index.mates) {
    const words = [mate.subject, mate.snippet].find(
      (candidate) => candidate !== undefined && contains(candidate, text),
    );
    if (words !== undefined) add(mate, words, "row");
  }
  const byEnvironment = new Map(
    index.mates.flatMap((mate) =>
      mate.environmentId === undefined ? [] : [[mate.environmentId, mate] as const],
    ),
  );
  for (const hit of hits) {
    const mate = byEnvironment.get(hit.environmentId);
    if (mate !== undefined) add(mate, hit.snippet, hit.threadId);
  }
  return [...said.values()].slice(0, JUMP_LIMITS.conversations);
}

export interface HighlightPart {
  readonly text: string;
  readonly match: boolean;
  /** Where the part starts in the text: its key among the others. */
  readonly start: number;
}

/**
 * The text cut where the query appears, every time it does. Nothing is
 * marked where folding the case would move the letters — a mark on the wrong
 * letters is worse than none.
 */
export function highlightParts(text: string, query: string): ReadonlyArray<HighlightPart> {
  const q = fold(query.trim());
  const folded = fold(text);
  if (q.length === 0 || folded.length !== text.length) return [{ text, match: false, start: 0 }];
  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, cursor)) {
    if (at > cursor) parts.push({ text: text.slice(cursor, at), match: false, start: cursor });
    parts.push({ text: text.slice(at, at + q.length), match: true, start: at });
    cursor = at + q.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false, start: cursor });
  return parts;
}

/** How much a hit keeps before and after the words it matched. */
const SNIPPET_BEFORE = 26;
const SNIPPET_AFTER = 40;

/**
 * The words around a match, on one line, rather than wherever the message
 * began — cut between words, never through one, and quoted as the rows quote
 * a message: markdown's marks dropped and every credential masked, before
 * the cut can part one from its name. The server's hit comes on one line
 * already, so a list's dash inside it stays a dash.
 */
export function snippetAround(text: string, query: string): string {
  const line = maskSecrets(messageWords(text));
  const needle = query.trim();
  const at = fold(line).indexOf(fold(needle));
  if (at === -1) return line;
  let start = Math.max(0, at - SNIPPET_BEFORE);
  let end = Math.min(line.length, at + needle.length + SNIPPET_AFTER);
  if (start > 0) {
    const space = line.indexOf(" ", start);
    if (space !== -1 && space < at) start = space + 1;
  }
  if (end < line.length) {
    const space = line.lastIndexOf(" ", end);
    if (space >= at + needle.length) end = space;
  }
  return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
}

/**
 * What Enter does with the words once a Mate is picked:
 * - `send` — a turn in its conversation, which a run already on reads at its
 *   next step;
 * - `answer` — the words answer the one question it asks;
 * - `open-and-send` — its conversation opens and sends them, the way a first
 *   message to a Mate goes;
 * - `open` — its conversation opens, where what it asks is answered;
 * - `wait` — what it waits on is still being read;
 * - `none` — the viewer may not write to it.
 */
export type JumpWriteAction = "send" | "answer" | "open-and-send" | "open" | "wait" | "none";

export interface JumpWritePlan {
  readonly hint: string;
  readonly action: JumpWriteAction;
}

const firstName = (name: string) => name.trim().split(/\s+/u)[0] ?? name;

/**
 * Who reads what is written to a Mate, when, and what Enter does with it —
 * one line in one voice: `Nova reads it now`, `Nova is working — it reads
 * this at its next step`, `Nova is waiting for your answer — this answers
 * it`.
 *
 * The box offers no Mate somebody else signed in (D6); one found to be theirs
 * after it was picked says so, and Enter does nothing, as its conversation
 * shows no composer.
 */
export function jumpWritePlan(input: {
  readonly name: string;
  readonly owner: { readonly name: string; readonly isViewer: boolean } | undefined;
  readonly conversation: JumpConversation;
  /** When a usage limit's pause ends, as the menu writes the time. */
  readonly pausedUntilLabel: string | undefined;
  readonly usageLimited?: boolean | undefined;
  /** Whether anybody asked it anything yet; undefined while its conversation is unread. */
  readonly started: boolean | undefined;
  readonly readOnly: boolean;
  /** What it waits on (`mateDecision`). */
  readonly decision: MateDecision | undefined;
}): JumpWritePlan {
  const { name, owner, conversation, decision } = input;
  if (input.readOnly) {
    const colleague = owner !== undefined && !owner.isViewer ? firstName(owner.name) : undefined;
    return {
      hint:
        colleague === undefined
          ? `Only the person who signed ${name} in writes to it`
          : `${name} is ${colleague}'s Mate — only ${colleague} writes to it`,
      action: "none",
    };
  }
  if (input.started === false) {
    return {
      hint: `${name} reads it now — its conversation opens with it`,
      action: "open-and-send",
    };
  }
  const plan = ((): JumpWritePlan => {
    switch (conversation.kind) {
      case "input":
        if (decision?.kind === "question" && !decision.allowText) {
          return {
            hint: `${name} is waiting for you to pick an answer — Enter opens it`,
            action: "open",
          };
        }
        if (decision?.kind === "questions") {
          return { hint: `${name} is waiting for your answers — Enter opens it`, action: "open" };
        }
        return {
          hint: `${name} is waiting for your answer — this answers it`,
          action: decision?.kind === "question" ? "answer" : "wait",
        };
      case "approval":
        return {
          hint: `${name} is waiting for your approval — it reads this once you decide`,
          action: "send",
        };
      default:
        break;
    }
    if (input.pausedUntilLabel !== undefined || input.usageLimited === true) {
      return {
        hint:
          input.pausedUntilLabel === undefined
            ? `${name} hit a usage limit. Sending tries again.`
            : `${name} hit a usage limit — can continue at ${input.pausedUntilLabel}. Sending tries again.`,
        action: "send",
      };
    }
    switch (conversation.kind) {
      case "planReady":
        return { hint: `${name} is waiting on its plan — this answers it`, action: "send" };
      case "working":
      case "connecting":
      case "monitoring":
        return { hint: `${name} is working — it reads this at its next step`, action: "send" };
      default:
        return { hint: `${name} reads it now`, action: "send" };
    }
  })();
  // Its conversation not read yet: what it would do is known, not the notes
  // a turn carries — Enter waits for them.
  return {
    hint: plan.hint,
    action: input.started === undefined && plan.action === "send" ? "wait" : plan.action,
  };
}

/** What a key does in the box, where the box answers it rather than its list. */
export type JumpKeyAction = "send" | "back-to-list" | "back-to-find" | "choose" | "hold";

export function jumpKey(input: {
  readonly key: string;
  readonly shift: boolean;
  readonly composing: boolean;
  /** A Mate is picked and the words are for it. */
  readonly targeted: boolean;
  readonly value: string;
}): JumpKeyAction | undefined {
  if (input.composing) return undefined;
  if (input.targeted) {
    if (input.key === "Enter") return input.shift ? undefined : "send";
    if (input.key === "Backspace") return input.value.length === 0 ? "back-to-list" : undefined;
    if (input.key === "Escape") return "back-to-find";
    if (input.key === "Tab") return "hold";
    return undefined;
  }
  if (input.key === "Tab" && !input.shift && input.value.startsWith("@")) return "choose";
  return undefined;
}

/**
 * Whether a key opens the box from the page: `/`, alone, where nothing is
 * being typed into and no menu, dialog or list has the keys.
 */
export function slashOpensJumpBox(input: {
  readonly key: string;
  readonly modified: boolean;
  readonly composing: boolean;
  readonly handled: boolean;
  /** The key went to a field, or to a menu, a dialog or a list. */
  readonly owned: boolean;
}): boolean {
  return input.key === "/" && !input.modified && !input.composing && !input.handled && !input.owned;
}
