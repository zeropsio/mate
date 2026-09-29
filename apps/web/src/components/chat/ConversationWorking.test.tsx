import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";

import type { IncidentModel } from "./conversation.logic";
import type { DockModel } from "./conversationDock.logic";
import { ConversationWorking } from "./ConversationWorking";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 10, minute)).toISOString();

/** A run some way in: its task list, three helpers and a background task at work. */
const DOCK: DockModel = {
  operations: [],
  helpers: {
    rows: [
      {
        id: "h1",
        title: "Review the API",
        tone: "ok",
        word: "Done",
        startedAt: at(1),
        endedAt: at(3),
      },
      {
        id: "h2",
        title: "Review the UI",
        tone: "busy",
        word: "Working",
        startedAt: at(1),
        endedAt: null,
      },
      {
        id: "h3",
        title: "Review the docs",
        tone: "busy",
        word: "Working",
        startedAt: at(2),
        endedAt: null,
      },
    ],
    working: 2,
    done: 1,
    failed: 0,
  },
  tasks: {
    steps: [
      { step: "Read the routes", status: "completed" },
      { step: "Fix the status route", status: "inProgress" },
      { step: "Deploy to stage", status: "pending" },
    ],
    done: 1,
    current: "Fix the status route",
  },
  background: {
    tasks: [
      {
        id: "b1",
        title: "Serve the app on port 3000",
        state: "running",
        watch: false,
        turnId: "t1",
        startedAt: at(2),
        endedAt: null,
      },
    ],
    running: 1,
    done: 0,
    failed: 0,
  },
  afterTurn: null,
  pause: null,
};

const INCIDENT: IncidentModel = {
  key: "incident:op:s1",
  hostname: "apidev",
  tone: "failed",
  phases: ["Not running", "HTTP 502"],
  appearedAt: at(4),
} as IncidentModel;

const render = (dock: DockModel | null, incidents: ReadonlyArray<IncidentModel> = []) =>
  renderToStaticMarkup(
    <ConversationWorking
      dock={dock}
      environmentId={null}
      incidents={incidents}
      onOpenAgents={() => undefined}
      threadRef={null}
    />,
  );

/** Each bar as drawn: its tag, its accessible name and the words it shows. */
function barsOf(markup: string) {
  const list = /<ul[^>]*data-working-instruments[^>]*>(.*)<\/ul>/s.exec(markup)?.[1] ?? "";
  return [...list.matchAll(/<(button|div)([^>]*)aria-label="([^"]*)"[^>]*>(.*?)<\/\1>/gs)].map(
    ([, tag, attributes = "", label = "", body = ""]) => ({
      tag,
      opens: tag === "button",
      attributes,
      label,
      text: body
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
      body,
    }),
  );
}

describe("what runs alongside the Mate", () => {
  it("draws nothing when nothing runs", () => {
    expect(render(null)).not.toContain("data-working-instruments");
  });

  // Rows are what it did, bars what runs now (the owner, 2026-09-27: "rows
  // and bars"): a bar per thing that runs, its name, where it is in words,
  // and a figure on the card's time column.
  it("draws a bar per thing that runs, each saying what it is in words", () => {
    expect(barsOf(render(DOCK, [INCIDENT])).map(({ text }) => text)).toEqual([
      "apidev Not running · HTTP 502",
      "Tasks Fix the status route 1/3",
      "3 helpers 2 working · 1 done",
      // How long it has run, from when it started.
      expect.stringMatching(/^Background Serve the app on port 3000 \d+[smhd]/),
    ]);
  });

  // "No unnecessary icons, make the use obvious from the component": the
  // bar's name says what it is, no mark in front of it.
  // No mark at rest: a bar's name says what it is. One that opens wears a
  // call's chevron after its figure, there at rest too, so what opens is
  // plain before the pointer finds it.
  it("wears no icon at rest, and a chevron where it opens", () => {
    for (const { body, opens } of barsOf(render(DOCK, [INCIDENT]))) {
      if (!opens) {
        expect(body).not.toContain("<svg");
        continue;
      }
      const chevron = /<svg[^>]*class="([^"]*)"/.exec(body)?.[1]?.split(" ") ?? [];
      expect(chevron).toEqual(expect.arrayContaining(["text-muted-foreground/55"]));
      expect(chevron).not.toContain("opacity-0");
    }
  });

  // A bar with more behind it opens it in place, under it — never a dialog
  // (the owner, 2026-09-27: "so much better expandable inline").
  it.each([
    { name: "apidev", opens: false },
    { name: "Tasks", opens: true },
    { name: "Helpers", opens: true },
    { name: "Background", opens: true },
  ])("opens $name's detail in place: $opens", ({ name, opens }) => {
    const bar = barsOf(render(DOCK, [INCIDENT])).find(({ label }) => label.startsWith(name));
    expect(bar?.opens).toBe(opens);
    if (opens) expect(bar?.attributes).toContain('aria-expanded="false"');
    expect(bar?.attributes).not.toContain("aria-haspopup");
  });

  it("shows the list under its bar when the person opens it, and folds it when they close it", () => {
    const observers = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    try {
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = create(
          <ConversationWorking
            dock={DOCK}
            environmentId={null}
            incidents={[]}
            onOpenAgents={() => undefined}
            threadRef={null}
          />,
        );
      });
      const tasks = () =>
        renderer.root.find(
          (node) => node.type === "button" && String(node.props["aria-label"]).startsWith("Tasks"),
        );
      const details = () =>
        renderer.root.findAll(
          (node) => node.type === "div" && node.props["data-working-detail"] !== undefined,
        );
      expect(details()).toHaveLength(0);
      act(() => tasks().props.onClick());
      expect(tasks().props["aria-expanded"]).toBe(true);
      expect(details()).toHaveLength(1);
      expect(
        details()[0]!.findAll((node) => node.props["data-plan-step"] !== undefined),
      ).toHaveLength(3);
      act(() => tasks().props.onClick());
      expect(details()).toHaveLength(0);
    } finally {
      globalThis.ResizeObserver = observers;
    }
  });

  // One right edge for every time in the card: the heading's, each line's
  // and each bar's.
  // One grid for the card (K1): the bar's name one column in, its figure on
  // the card's right edge.
  it("sets each bar in the card's grid, its figure on the right edge", () => {
    const markup = render(DOCK);
    const bars = [...markup.matchAll(/class="run-bar[^"]*"/g)];
    expect(bars).toHaveLength(3);
    const figures = [
      ...markup.matchAll(
        /<span class="(flex items-center gap-1\.5 text-muted-foreground tabular-nums)">/g,
      ),
    ];
    expect(figures).toHaveLength(3);
  });
});
