import { renderToStaticMarkup } from "react-dom/server";
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
      browser={null}
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
      opens: attributes.includes('aria-haspopup="dialog"') || tag === "button",
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
  it("puts no icon on a bar", () => {
    for (const { body } of barsOf(render(DOCK, [INCIDENT]))) expect(body).not.toContain("<svg");
  });

  // A bar with more behind it opens it in a modal; nothing opens in place.
  it.each([
    { name: "apidev", opens: false },
    { name: "Tasks", opens: true },
    { name: "Helpers", opens: true },
    { name: "Background", opens: true },
  ])("opens $name's detail in a modal: $opens", ({ name, opens }) => {
    const bar = barsOf(render(DOCK, [INCIDENT])).find(({ label }) => label.startsWith(name));
    expect(bar?.opens).toBe(opens);
    expect(bar?.body).not.toContain("aria-expanded");
  });

  // One right edge for every time in the card: the heading's, each line's
  // and each bar's.
  it("sets each bar's figure on the card's time column", () => {
    const markup = render(DOCK);
    const figures = [...markup.matchAll(/<span class="(w-14 shrink-0 text-end[^"]*)">/g)];
    expect(figures).toHaveLength(3);
    for (const [, classes = ""] of figures) expect(classes).toContain("tabular-nums");
  });
});
