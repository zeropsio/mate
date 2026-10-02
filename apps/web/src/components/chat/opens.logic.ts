/**
 * Expand only where there is more (pass 35, the owner: "we need to take care
 * of not showing expand where there is nothing to expand"). One rule for every
 * control in the run's card that opens: it is drawn only when what it opens
 * shows something not already on screen. A row whose line says all of it is
 * the whole of it — no chevron, and it does not press.
 *
 * One function, a case per control, so one table-driven test holds the card.
 */
import type { WorkLogEntry } from "../../session-logic";
import type { WorkStep } from "./workSteps.logic";

/** The runtime's `Name: {json}` detail of a call: its arguments, never output to show. */
const CALL_ARGUMENTS = /^[A-Za-z][\w-]*:\s*[{[]/;

/** A block a step opens onto, under its line. */
export interface StepOutput {
  readonly key: string;
  readonly label: string | null;
  readonly text: string;
}

/**
 * What a step holds besides what its line says: what it printed or returned,
 * the files of an edit of several files, what a search or a read of the web
 * was asked past what its line names. Nothing for a call whose line is the
 * whole of it — a read, a one-file edit, a search for a pattern alone.
 */
export function stepOutput(step: WorkStep): ReadonlyArray<StepOutput> {
  const blocks: StepOutput[] = [];
  step.entries.forEach((entry, index) => {
    const command = (entry.rawCommand ?? entry.command)?.trim();
    if (step.kind === "edit") {
      const files = editedFiles(entry);
      // One file is the one its line names.
      if (files.length > 1)
        blocks.push({ key: `${index}:files`, label: "Files", text: files.join("\n") });
    }
    const asked = askedPastTheLine(entry, step.kind);
    if (asked.length > 0) {
      blocks.push({ key: `${index}:asked`, label: "Asked", text: asked.join("\n") });
    }
    const detail = entry.detail?.trim();
    if (
      detail &&
      detail !== command &&
      !CALL_ARGUMENTS.test(detail) &&
      !(step.kind === "look" && step.images.includes(detail))
    ) {
      blocks.push({
        key: `${index}:output`,
        label: step.kind === "command" && blocks.length === 0 ? null : "Returned",
        text: detail,
      });
    }
  });
  return blocks;
}

function editedFiles(entry: WorkLogEntry): string[] {
  return [
    ...new Set([
      ...(entry.changedFiles ?? []),
      ...(entry.callInput?.filePath ? [entry.callInput.filePath] : []),
    ]),
  ];
}

/**
 * What a search or a read of the web was asked that its line does not say:
 * the line names the pattern, the address or the query — the glob and the
 * folder it searched in are more.
 */
function askedPastTheLine(entry: WorkLogEntry, kind: WorkStep["kind"]): string[] {
  if (kind !== "search" && kind !== "web") return [];
  const input = entry.callInput;
  return [
    input?.glob && input.glob !== input.pattern ? `glob     ${input.glob}` : null,
    input?.path ? `in       ${input.path}` : null,
  ].filter((line): line is string => line !== null);
}

/** Whether a helper's report says more than its line: its state word, its first line under it. */
function helperReportAdds(report: string | null, state: string): boolean {
  const said = report?.trim() ?? "";
  if (said.length === 0) return false;
  const lines = said.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > 1) return true;
  if (said.replace(/[.!]$/u, "").toLowerCase() === state.toLowerCase()) return false;
  return said.length > HELPER_LINE_CHARS;
}

/** How long a helper's one line of report stands whole under its title, at the card's width. */
export const HELPER_LINE_CHARS = 72;

/**
 * The first line of a helper's report under its title while closed — none
 * where it repeats the state word beside it ("Done" under "Done").
 */
export function helperReportPreview(report: string | null, state: string): string | null {
  const said = report?.trim() ?? "";
  const first =
    said
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? null;
  if (first === null) return null;
  return first.replace(/[.!]$/u, "").toLowerCase() === state.toLowerCase() ? null : first;
}

/** A control that opens, by what it would open and what its line already shows. */
export type Opener =
  /** An operation's row or bar: its card's parts, its services' lines, a reason its line cut short. */
  | { readonly control: "operation"; readonly lines: number; readonly reasonCut: boolean }
  /** The Background bar: a row per task, under a bar that names the one running. */
  | { readonly control: "background-bar"; readonly tasks: number }
  /** The to-do list's row: its steps, under a line naming the one in hand. */
  | {
      readonly control: "plan";
      readonly steps: ReadonlyArray<string>;
      readonly current: string | null;
    }
  /** The helpers a launch started: a row each. */
  | { readonly control: "helpers"; readonly agents: number }
  /** A row of browser checks: each take, its picture, what it read of the page. */
  | {
      readonly control: "checks";
      readonly checks: number;
      /** Takes with a picture, a read of the page or a reason it failed. */
      readonly shown: number;
    }
  /** A helper's report, under its title and state. */
  | { readonly control: "helper"; readonly report: string | null; readonly state: string }
  /** A step: what it printed, past its code's four lines. */
  | { readonly control: "step"; readonly step: WorkStep; readonly codeCut: boolean }
  /** A thought: past its four lines. */
  | { readonly control: "thought"; readonly pastCap: boolean }
  /** "Show work" on a settled run's line: the scroll of what the run shows. */
  | { readonly control: "work"; readonly lines: number }
  /** A picture of the result: the viewer, onto a file still there or the pictures past it. */
  | { readonly control: "picture"; readonly gone: boolean; readonly more: number }
  /** The live slot: the thing in full up to its cap — never a chevron. */
  | { readonly control: "live" };

/** Whether a control opens onto something not already on screen: else it is not drawn. */
export function opensOnto(opener: Opener): boolean {
  switch (opener.control) {
    case "operation":
      return opener.lines > 0 || opener.reasonCut;
    case "background-bar":
      // One task's row says the bar's own title and time again.
      return opener.tasks > 1;
    case "plan":
      return (
        opener.steps.length > 1 || (opener.steps.length === 1 && opener.steps[0] !== opener.current)
      );
    case "helpers":
      return opener.agents > 0;
    case "checks":
      return opener.checks > 1 || opener.shown > 0;
    case "helper":
      return helperReportAdds(opener.report, opener.state);
    case "step":
      return opener.codeCut || stepOutput(opener.step).length > 0;
    case "thought":
      return opener.pastCap;
    case "work":
      return opener.lines > 0;
    case "picture":
      return !opener.gone || opener.more > 0;
    case "live":
      return false;
  }
}

/**
 * Whether a control's detail stands open: the person opened it, and the
 * control still opens. A bar whose rows dropped to none closes with its
 * chevron, never left open with no way to close it.
 */
export function standsOpen(opened: boolean, stillOpens: boolean): boolean {
  return opened && stillOpens;
}
