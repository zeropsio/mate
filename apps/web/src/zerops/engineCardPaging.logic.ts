/**
 * An engine Mate's run not held whole when its card paints (`engineCardPaging`): its worked line
 * counts its effort from the server's summary of its runs, and its scroll draws the stretch of
 * lines held whole, the rest paging in as the person opens it and scrolls to them.
 */
import type { EngineCardCounts, EngineCardPaging } from "@t3tools/client-runtime/data";
import { classifyZeropsCall } from "@t3tools/client-runtime/zerops/model";

import {
  ACTIVITY_ORDER,
  ZEROPS_TOOL_KIND,
  type ActivityKind,
  type OutcomeActivity,
  type OutcomeModel,
} from "../components/chat/conversation.logic";

/** A call's step as the worked line counts it; a generic or MCP call by its tool. */
const STEP_KIND: Readonly<Record<string, ActivityKind>> = {
  command: "command",
  read: "read",
  look: "read",
  search: "code-search",
  web: "search",
  helper: "helpers",
};

/**
 * What a tool's calls count as: a Zerops tool by what it did ("the workflow checked"), never one
 * whose result is a row of its card (a deploy, a check) or the timeline leaves out.
 */
function toolKind(name: string): ActivityKind | null {
  const bare = name.split("__").at(-1) ?? name;
  if (classifyZeropsCall(bare, undefined, "completed") !== "generic") return null;
  return ZEROPS_TOOL_KIND[bare] ?? "tool";
}

/** What a card's calls came to, by kind, from its runs' summaries: its worked line's effort. */
export function effortOfCounts(counts: EngineCardCounts): OutcomeActivity[] {
  const by = new Map<ActivityKind, number>();
  const add = (kind: ActivityKind, count: number) => {
    if (count > 0) by.set(kind, (by.get(kind) ?? 0) + count);
  };
  let generic = 0;
  for (const [step, count] of Object.entries(counts.calls)) {
    if (step === "edit") continue;
    const kind = STEP_KIND[step];
    if (kind === undefined) generic += count;
    else add(kind, count);
  }
  add("edit", counts.edited ?? counts.calls.edit ?? 0);
  for (const [name, count] of Object.entries(counts.tools)) {
    generic -= count;
    const kind = toolKind(name);
    if (kind !== null) add(kind, count);
  }
  // Calls the summary named no tool for (its budget kept only the most).
  add("tool", generic);
  return ACTIVITY_ORDER.flatMap((kind) => {
    const count = by.get(kind);
    return count === undefined ? [] : [{ kind, count }];
  });
}

/** A settled card's outcome with its effort counted from its summary, when it pages. */
export function withPagedEffort(
  outcome: OutcomeModel | null,
  paging: EngineCardPaging | null,
): OutcomeModel | null {
  if (outcome === null || paging === null) return outcome;
  return { ...outcome, activity: effortOfCounts(paging.counts) };
}

/** The lines a paging card's scroll draws: those within the stretch held whole. */
export function heldLines<Line extends { readonly at: string }>(
  lines: ReadonlyArray<Line>,
  paging: EngineCardPaging | null,
): ReadonlyArray<Line> {
  if (paging === null || (paging.since === null && paging.through === null)) return lines;
  if (!paging.holdsLines) return [];
  const since = paging.since === null ? Number.NEGATIVE_INFINITY : Date.parse(paging.since);
  const through = paging.through === null ? Number.POSITIVE_INFINITY : Date.parse(paging.through);
  return lines.filter((line) => {
    const at = Date.parse(line.at);
    return at >= since && at <= through;
  });
}

/** Which way a paging card's scroll has lines still to read, and whether a page is on its way. */
export interface ScrollPages {
  readonly earlier: boolean;
  readonly later: boolean;
  readonly reading: boolean;
  readonly read: (direction: "earlier" | "later") => void;
}

/** How near its end the scroll reads the next page: before the person reaches it. */
export const PAGE_REACH_PX = 480;

/**
 * Which page a scroll standing at `scroll` reads next: the later one as its foot nears, the earlier
 * one as its top nears with every held line drawn (`from` 0); none while one is on its way.
 */
export function pageReached(
  scroll: {
    readonly scrollTop: number;
    readonly scrollHeight: number;
    readonly clientHeight: number;
  },
  from: number,
  pages: Pick<ScrollPages, "earlier" | "later" | "reading">,
): "earlier" | "later" | null {
  if (pages.reading) return null;
  if (pages.later && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < PAGE_REACH_PX)
    return "later";
  if (pages.earlier && from === 0 && scroll.scrollTop < PAGE_REACH_PX) return "earlier";
  return null;
}
