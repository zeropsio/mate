import { TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";

import { BrowserTakes } from "./BrowserStrip";
import type { OutcomeModel } from "./conversation.logic";
import { TurnReport } from "./TurnReport";

const at = (second: number) => new Date(Date.UTC(2026, 8, 27, 10, 0, second)).toISOString();

/** A browser check that took its screenshot on a desktop, unless told otherwise. */
const take = (key: string, overrides: Partial<ZeropsOperation> = {}): ZeropsOperation => ({
  key,
  kind: "browser",
  phase: "done",
  anchorAt: at(0),
  anchorActivityId: key,
  settledAt: at(3),
  turnId: "turn-1",
  subject: "https://appdev.example.dev/",
  kicker: "Browser · appdev",
  voice: "Checking /",
  voiceSource: "mate",
  statusWord: "Checked",
  steps: [],
  links: [],
  callIds: [key],
  hasResult: true,
  screenshot: { src: "data:image/png;base64,iVBORw0KGgo=", width: 1440, height: 900 },
  viewport: { width: 1440, height: 900 },
  ...overrides,
});

/** A turn that did a bit of everything the report tells. */
const OUTCOME: OutcomeModel = {
  key: "outcome:turn-1",
  turnKey: "turn-1",
  live: [
    {
      hostname: "appdev",
      tone: "ok",
      word: "Deployed",
      version: "a3f9c2d",
      url: null,
      recovered: "came back after a failed build",
    },
  ],
  landed: [{ key: "pr:2", line: "#2", title: "Add the weather page" }],
  files: { count: 3, additions: 42, deletions: 7, turnId: TurnId.make("turn-1") },
  checks: {
    count: 3,
    views: 2,
    failures: 1,
    takes: [
      take("op:admin", {
        subject: "https://appdev.example.dev/admin",
        phase: "failed",
        statusWord: "Failed",
      }),
      take("op:home"),
      take("op:phone", {
        deviceName: "iPhone 14",
        screenshot: { src: "data:image/png;base64,iVBORw0KGgo=", width: 390, height: 844 },
      }),
    ],
  },
  created: ["db"],
  removed: ["cache"],
  notDone: ["Enable the subdomain"],
  activity: [
    {
      kind: "command",
      count: 2,
      words: "Ran 2 commands",
      entries: [
        {
          id: "c1",
          createdAt: at(1),
          label: "Command run",
          tone: "tool",
          itemType: "command_execution",
          command: "npm run build",
          callInput: { description: "Run the production build" },
          toolLifecycleStatus: "completed",
        },
        {
          id: "c2",
          createdAt: at(2),
          label: "Command run",
          tone: "tool",
          itemType: "command_execution",
          command: "npm test",
          toolLifecycleStatus: "completed",
        },
      ],
    },
    { kind: "helpers", count: 11, words: "Started 11 helpers", entries: [] },
  ],
};

const markup = renderToStaticMarkup(
  <TurnReport onOpenImage={() => undefined} onOpenTurnDiff={() => undefined} outcome={OUTCOME} />,
);

/** The pictures the checks took, as the checks pill opens them. */
const takesMarkup = renderToStaticMarkup(
  <BrowserTakes onOpenImage={() => undefined} takes={OUTCOME.checks!.takes} />,
);

/** The class list of every opening tag that carries `marker`, in document order. */
function classesOf(marker: string, within: string = markup): ReadonlyArray<ReadonlyArray<string>> {
  return [...within.matchAll(/<[a-z][^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes(marker))
    .map((tag) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" "));
}

/** Where a box's content starts from its own edge, in spacing steps: its start margin and padding. */
function startOffset(classes: ReadonlyArray<string>): number {
  let offset = 0;
  for (const name of classes) {
    const match = /^(-?)(m|mx|ms|p|px|ps)-(\d+(?:\.\d+)?)$/.exec(name);
    if (match) offset += (match[1] === "-" ? -1 : 1) * Number(match[3]);
  }
  return offset;
}

describe("TurnReport", () => {
  it("says every pill's words at the status bars' size", () => {
    const pills = classesOf("data-pill");
    expect(pills.length).toBeGreaterThan(5);
    for (const pill of pills) {
      expect(pill).toContain("text-line");
      expect(pill).not.toContain("text-xs");
    }
  });

  // What its calls came to is a pill like the rest of the result, and it
  // opens what it counts (the owner, 2026-09-27: "why isn't [it] in the
  // result style?"). Its words say it: no mark in front of them.
  it.each(["Ran 2 commands", "Started 11 helpers"])("opens %s from its pill, in place", (words) => {
    const pill = new RegExp(
      `<button[^>]*aria-label="${words}. Show them"[^>]*>(.*?)</button>`,
    ).exec(markup);
    expect(pill?.[0]).toContain("data-pill");
    expect(pill?.[0]).toContain('aria-expanded="false"');
    expect(pill?.[1]).not.toContain("rounded-full");
    expect(pill?.[1]).toContain(words);
  });

  // What a pill counts opens under the pills as the chat's own bubbles: the
  // same command, said the same way, as where it ran (the owner, 2026-09-27:
  // "so much better expandable inline").
  it("opens what an activity pill counts under the pills, one pill at a time", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <TurnReport
          onOpenImage={() => undefined}
          onOpenTurnDiff={() => undefined}
          outcome={OUTCOME}
        />,
      );
    });
    const pill = (words: string) =>
      renderer.root.find(
        (node) => node.type === "button" && String(node.props["aria-label"]).startsWith(words),
      );
    const details = () =>
      renderer.root.findAll(
        (node) => node.type === "div" && node.props["data-report-detail"] !== undefined,
      );
    expect(details()).toHaveLength(0);
    act(() => pill("Ran 2 commands").props.onClick());
    expect(pill("Ran 2 commands").props["aria-expanded"]).toBe(true);
    const commands = details()[0]!.findAll(
      (node) => node.type === "div" && node.props["data-chat-kind"] === "step:command",
    );
    expect(commands).toHaveLength(2);
    act(() => pill("3 checks of 2 pages").props.onClick());
    expect(pill("Ran 2 commands").props["aria-expanded"]).toBe(false);
    expect(details()).toHaveLength(1);
    expect(
      details()[0]!.findAll((node) => node.props["data-report-take"] !== undefined),
    ).toHaveLength(3);
  });

  // The pictures are the chat's, where the checks ran: the result shows them
  // only when its checks pill is opened, never twice at rest.
  it("keeps the takes behind the checks pill", () => {
    expect(markup).not.toContain("data-report-takes");
    expect(markup).toMatch(/aria-label="3 checks of 2 pages, 1 failed\. Show the pictures"/);
  });

  // A text action in the conversation is said in its link ink, as the
  // answer's markdown links and the panel's "Open the helpers panel" are.
  it("says Review in the conversation's link ink", () => {
    const review = /<span class="([^"]*)">Review<\/span>/.exec(markup)?.[1]?.split(" ") ?? [];
    expect(review).toContain("text-info-foreground");
  });

  // Flat cards: a shadow is a popover's; a take reads as an object by its border.
  it("casts no shadow, and every take keeps its border", () => {
    expect(markup).not.toMatch(/class="[^"]*\bshadow/);
    expect(takesMarkup).not.toMatch(/class="[^"]*\bshadow/);
    const takes = classesOf("data-report-take=", takesMarkup);
    expect(takes).toHaveLength(3);
    for (const thumbnail of takes) expect(thumbnail).toContain("border");
  });

  // One text edge: the takes stand where the pills do, and what room they
  // keep around themselves for a ring hangs outside that edge.
  it.each([
    { row: "pills", marker: "data-report-pills", within: markup },
    { row: "takes", marker: "data-report-takes", within: takesMarkup },
  ])("starts the $row on the report's text edge", ({ marker, within }) => {
    const [row = []] = classesOf(marker, within);
    expect(row.length).toBeGreaterThan(0);
    expect(startOffset(row)).toBe(0);
  });

  it("keeps room around its takes for a failed take's ring and the focus ring", () => {
    const [row = []] = classesOf("data-report-takes", takesMarkup);
    const room = row.find((name) => name.startsWith("p-"));
    expect(Number(room?.slice(2))).toBeGreaterThanOrEqual(0.5);
    expect(row.some((name) => /^p[xytbse]-/.test(name))).toBe(false);
    const failed = classesOf("data-report-take=", takesMarkup).find((thumbnail) =>
      thumbnail.includes("ring-status-failed"),
    );
    expect(failed).toEqual(expect.arrayContaining(["ring-1", "border-status-failed"]));
  });
});
