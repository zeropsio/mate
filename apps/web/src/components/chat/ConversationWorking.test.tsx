import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { IncidentModel } from "./conversation.logic";
import type { DockModel } from "./conversationDock.logic";
import { ConversationAfterWork, ConversationWorking } from "./ConversationWorking";
import type { stepHeight } from "./stepHeight";

/** How the panel asked its room to close: the frames are the stepper's own to test. */
// The kit's tooltip needs a window; here the name it holds is what counts.
vi.mock("../ui/tooltip", async () => {
  const { cloneElement, isValidElement } = await import("react");
  return {
    Tooltip: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({
      render,
      children,
    }: {
      readonly render: unknown;
      readonly children: ReactNode;
    }) => (isValidElement(render) ? cloneElement(render, undefined, children) : <>{children}</>),
    TooltipPopup: () => null,
  };
});

// The project as the platform states it: the incident's service runs its version.
vi.mock("../../zerops/useZeropsFeeds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../zerops/useZeropsFeeds")>()),
  useZeropsTopology: () => ({
    project: { id: "proj-1", name: "orchard" },
    services: [{ hostname: "apidev", serviceId: "svc-api", status: "ACTIVE", routes: [] }],
    warnings: [],
    usageRead: true,
  }),
}));

const closings = vi.hoisted(() => [] as Array<Parameters<typeof stepHeight>[0]>);
vi.mock("./stepHeight", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stepHeight")>()),
  stepHeight: (options: Parameters<typeof stepHeight>[0]) => {
    closings.push(options);
    return () => undefined;
  },
}));

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
  // Every dock a test drew is taken down with it: one left drawn keeps its
  // bars' clocks ticking past the test, into the next file's run.
  const drawn: ReactTestRenderer[] = [];
  const mounted = (...args: Parameters<typeof create>): ReactTestRenderer => {
    const renderer = create(...args);
    drawn.push(renderer);
    return renderer;
  };
  afterEach(() => {
    act(() => {
      for (const renderer of drawn.splice(0)) renderer.unmount();
    });
  });

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
      // Several helpers: their count and the newest at work, its mark says how.
      expect.stringMatching(/^3 helpers Review the docs \d+[smhd]/),
      // The background's glyph in place of its name, and how long it has run.
      expect.stringMatching(/^Serve the app on port 3000 \d+[smhd]/),
    ]);
  });

  // "No unnecessary icons, make the use obvious from the component": the
  // bar's name says what it is, no mark in front of it.
  // No mark at rest: a bar's name says what it is. One that opens wears a
  // call's chevron after its figure, there at rest too, so what opens is
  // plain before the pointer finds it.
  // The background wears its glyph in place of its name (pass 43, R12-9).
  it("wears no icon at rest but the background's glyph, and a chevron where it opens", () => {
    for (const { body, opens, label } of barsOf(render(DOCK, [INCIDENT]))) {
      if (!opens) {
        expect(body.match(/<svg/g)?.length ?? 0).toBe(label.startsWith("Background") ? 1 : 0);
        continue;
      }
    }
  });

  // A bar with more behind it opens it in place, under it — never a dialog
  // (the owner, 2026-09-27: "so much better expandable inline").
  it.each([
    { name: "apidev", opens: false },
    { name: "Tasks", opens: true },
    { name: "Helpers", opens: true },
    // One task: its row would say the bar's own title and time again (pass 35).
    { name: "Background", opens: false },
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
        renderer = mounted(
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

  // A bar closes with its chevron when its rows drop to one, and stays closed
  // when they come back: it never springs open by itself (pass 35).
  it("never springs a bar open by itself after its rows dropped and came back", () => {
    const observers = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    const task = (id: string) => ({ ...DOCK.background!.tasks[0]!, id, title: `Task ${id}` });
    const withTasks = (ids: ReadonlyArray<string>): DockModel => ({
      ...DOCK,
      background: { tasks: ids.map(task), running: ids.length, done: 0, failed: 0 },
    });
    const draw = (dock: DockModel) => (
      <ConversationWorking
        dock={dock}
        environmentId={null}
        incidents={[]}
        onOpenAgents={() => undefined}
        threadRef={null}
      />
    );
    try {
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = mounted(draw(withTasks(["b1", "b2"])));
      });
      const bar = () =>
        renderer.root.findAll(
          (node) =>
            node.type === "button" && String(node.props["aria-label"]).includes("Background"),
        );
      act(() => bar()[0]!.props.onClick());
      expect(bar()[0]!.props["aria-expanded"]).toBe(true);
      act(() => renderer.update(draw(withTasks(["b2"]))));
      expect(bar()).toHaveLength(0);
      act(() => renderer.update(draw(withTasks(["b2", "b3"]))));
      expect(bar()[0]!.props["aria-expanded"]).toBe(false);
    } finally {
      globalThis.ResizeObserver = observers;
    }
  });

  // A bar that leaves gives its room back (the owner, 2026-09-30, of a
  // finished deploy's room kept under a live line: "what's up with the big
  // space … at the bottom"): the room is held where it stood and closes from
  // there. One that arrives is followed at once.
  it("gives back the room of a bar that leaves, and follows one that arrives at once", () => {
    const observers = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    closings.length = 0;
    try {
      // The panel as the page lays it out: the room its bars take, unless held.
      let bars = 96;
      const panel = {
        style: { height: "" },
        closest: () => null,
        getBoundingClientRect: () => ({
          height: panel.style.height === "" ? bars : Number.parseFloat(panel.style.height),
        }),
      };
      const rooms: Array<number | null> = [];
      const draw = (dock: DockModel | null) => (
        <ConversationWorking
          dock={dock}
          environmentId={null}
          incidents={[]}
          onOpenAgents={() => undefined}
          onRoom={(room) => rooms.push(room)}
          threadRef={null}
        />
      );
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = mounted(draw(DOCK), {
          createNodeMock: (element) =>
            (element.props as Record<string, unknown>)["data-conversation-working"] === undefined
              ? {}
              : panel,
        });
      });
      expect(closings).toHaveLength(0);
      bars = 0;
      act(() => renderer.update(draw(null)));
      expect(closings).toHaveLength(1);
      expect(closings[0]).toMatchObject({ element: panel, from: 96, to: 0 });
      expect(rooms).toEqual([96]);
      bars = 96;
      act(() => renderer.update(draw(DOCK)));
      expect(closings).toHaveLength(1);
      expect(rooms).toEqual([96, null]);
    } finally {
      globalThis.ResizeObserver = observers;
    }
  });

  // While a run streams beside it the panel is drawn on every word, its own
  // bars unchanged: a draw that changed nothing in its room reads no layout.
  it("reads its room only after a draw that changed something in it", () => {
    const saved = { resize: globalThis.ResizeObserver, mutation: globalThis.MutationObserver };
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    // What the page changed in the room since the last look.
    let changed: unknown[] = [];
    globalThis.MutationObserver = class {
      observe() {}
      disconnect() {}
      takeRecords() {
        const records = changed;
        changed = [];
        return records;
      }
    } as unknown as typeof MutationObserver;
    closings.length = 0;
    try {
      let bars = 96;
      let reads = 0;
      const panel = {
        style: { height: "" },
        closest: () => null,
        getBoundingClientRect: () => {
          reads += 1;
          return {
            height: panel.style.height === "" ? bars : Number.parseFloat(panel.style.height),
          };
        },
      };
      const draw = (dock: DockModel | null) => (
        <ConversationWorking
          dock={dock}
          environmentId={null}
          incidents={[]}
          onOpenAgents={() => undefined}
          threadRef={null}
        />
      );
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = mounted(draw(DOCK), {
          createNodeMock: (element) =>
            (element.props as Record<string, unknown>)["data-conversation-working"] === undefined
              ? {}
              : panel,
        });
      });
      const mountedReads = reads;
      act(() => renderer.update(draw({ ...DOCK })));
      expect(reads).toBe(mountedReads);
      bars = 0;
      changed = [{ type: "childList" }];
      act(() => renderer.update(draw(null)));
      expect(reads).toBeGreaterThan(mountedReads);
      expect(closings).toHaveLength(1);
      expect(closings[0]).toMatchObject({ from: 96, to: 0 });
    } finally {
      globalThis.ResizeObserver = saved.resize;
      globalThis.MutationObserver = saved.mutation;
    }
  });

  // Under reduced motion a bar that leaves gives its room back at once.
  it("gives back the room of a bar that leaves at once under reduced motion", () => {
    const observers = globalThis.ResizeObserver;
    const savedWindow = (globalThis as { window?: unknown }).window;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    (globalThis as { window?: unknown }).window = {
      matchMedia: (query: string) => ({ matches: query.includes("reduce") }),
    };
    closings.length = 0;
    try {
      let bars = 96;
      const panel = {
        style: { height: "" },
        closest: () => null,
        getBoundingClientRect: () => ({
          height: panel.style.height === "" ? bars : Number.parseFloat(panel.style.height),
        }),
      };
      const draw = (dock: DockModel | null) => (
        <ConversationWorking
          dock={dock}
          environmentId={null}
          incidents={[]}
          onOpenAgents={() => undefined}
          threadRef={null}
        />
      );
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = mounted(draw(DOCK), {
          createNodeMock: (element) =>
            (element.props as Record<string, unknown>)["data-conversation-working"] === undefined
              ? {}
              : panel,
        });
      });
      bars = 0;
      act(() => renderer.update(draw(null)));
      expect(closings).toHaveLength(0);
    } finally {
      globalThis.ResizeObserver = observers;
      (globalThis as { window?: unknown }).window = savedWindow;
    }
  });
});

// One place per fact (pass 43, R12-9): no bar, no "n working", no "n/total";
// a count only where there are several, the others in words.
describe("the helpers' and the background's bands", () => {
  const helpers = DOCK.helpers!;
  const background = DOCK.background!;
  const task = (id: string, state: "running" | "done" | "failed", minute: number) => ({
    ...background.tasks[0]!,
    id,
    title: `Task ${id}`,
    state,
    startedAt: at(minute),
    endedAt: state === "running" ? null : at(minute + 1),
  });
  const band = (dock: DockModel, name: string) =>
    barsOf(render(dock)).find(({ label }) => label.startsWith(name));
  const only = (over: Partial<DockModel>): DockModel => ({
    ...DOCK,
    tasks: null,
    helpers: null,
    background: null,
    ...over,
  });

  it.each([
    {
      name: "one helper: its title and its time, no count",
      dock: only({ helpers: { ...helpers, rows: [helpers.rows[1]!] } }),
      bar: "Helper",
      says: /^Review the UI( \d+[smhd]){1,2}$/,
      label: "Helper: Review the UI, working",
    },
    {
      name: "several helpers: the count and the newest at work",
      dock: only({ helpers }),
      bar: "Helpers",
      says: /^3 helpers Review the docs( \d+[smhd]){1,2}$/,
      label: "Helpers: 3, Review the docs, working",
    },
    {
      name: "one background task: its title and its time",
      dock: only({ background }),
      bar: "Background",
      says: /^Serve the app on port 3000( \d+[smhd]){1,2}$/,
      label: "Background: Serve the app on port 3000, running",
    },
    {
      name: "background tasks: the running one, the others in words",
      dock: only({
        background: {
          ...background,
          tasks: [task("seed", "done", 1), task("build", "running", 2)],
        },
      }),
      bar: "Background",
      says: /^Task build · 1 other done( \d+[smhd]){1,2}$/,
      label: "Background: Task build, running, 1 other done",
    },
  ])("$name", ({ dock, bar, says, label }) => {
    const drawn = band(dock, bar);
    expect(drawn?.text).toMatch(says);
    expect(drawn?.label.startsWith(label)).toBe(true);
    expect(drawn?.body).not.toContain("data-status-bar");
  });

  it.each([
    { name: "Helpers", dock: only({ helpers }), titles: helpers.rows.map((row) => row.title) },
    {
      name: "Background",
      dock: only({
        background: {
          ...background,
          tasks: [task("seed", "done", 1), task("build", "running", 2)],
        },
      }),
      titles: ["Task seed", "Task build"],
    },
  ])("opened, $name shows a row each: its mark, its title, its time", ({ name, dock, titles }) => {
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
            dock={dock}
            environmentId={null}
            incidents={[]}
            onOpenAgents={() => undefined}
            threadRef={null}
          />,
        );
      });
      const opener = renderer.root.find(
        (node) => node.type === "button" && String(node.props["aria-label"]).startsWith(name),
      );
      act(() => opener.props.onClick());
      const detail = renderer.root.find(
        (node) => node.type === "div" && node.props["data-working-detail"] !== undefined,
      );
      const rows = detail.findAll((node) => node.type === "li");
      expect(rows).toHaveLength(titles.length);
      const text = (node: (typeof rows)[number]): string =>
        node.children.map((child) => (typeof child === "string" ? child : text(child))).join(" ");
      rows.forEach((row, index) => expect(text(row)).toContain(titles[index]));
      act(() => renderer.unmount());
    } finally {
      globalThis.ResizeObserver = observers;
    }
  });

  // Every state is one line: nothing shifts as helpers start and end.
  it("stays one line as helpers start and end", () => {
    const lines = [
      [helpers.rows[1]!],
      helpers.rows,
      helpers.rows.map((row) => ({ ...row, tone: "ok" as const, endedAt: at(9) })),
    ].map((rows) => {
      const drawn = band(only({ helpers: { ...helpers, rows } }), "Helper");
      return drawn?.body.match(/<(br|div|li)\b/g)?.length ?? 0;
    });
    expect(lines).toEqual([0, 0, 0]);
  });
});

// Eli, 2026-10-14: "Still working in the background" stood over nothing while four of its own
// background checks ran — "what is still working on bg?".
describe("the Mate at work after its turn", () => {
  const afterWork = (dock: DockModel | null) =>
    renderToStaticMarkup(
      <ConversationAfterWork
        dock={dock}
        environmentId={null}
        onOpenAgents={() => undefined}
        speaker={{ name: "Eli", tint: "sky" }}
        state="working"
        threadRef={null}
      />,
    );
  const after = (work: NonNullable<DockModel["afterWork"]> | undefined): DockModel => ({
    operations: [],
    helpers: null,
    tasks: null,
    background: null,
    afterTurn: "working",
    ...(work === undefined ? {} : { afterWork: work }),
    pause: null,
  });
  const job = (title: string) => ({ title, of: "mate", since: Date.parse(at(1)) }) as const;

  // S21-02: "Still working in the background" stood on after the person's Stop.
  it.each([
    { stopping: false, head: "Still working in the background" },
    { stopping: true, head: "Stopping…" },
  ])("says it is stopping once a person's Stop is in force: stopping $stopping", (row) => {
    const markup = renderToStaticMarkup(
      <ConversationAfterWork
        dock={after({ items: [job("Final batched browser check")], count: 1 })}
        environmentId={null}
        onOpenAgents={() => undefined}
        speaker={{ name: "Eli", tint: "sky" }}
        state="working"
        stopping={row.stopping}
        threadRef={null}
      />,
    );
    expect(markup).toContain(row.head);
  });

  it("names what still runs under its head, and whose it is", () => {
    const markup = afterWork(
      after({
        items: [
          job("Final batched browser check"),
          { title: "Review the diff", of: "helper", since: Date.parse(at(2)) },
        ],
        count: 2,
      }),
    );
    expect(markup).toContain("Still working in the background");
    expect(markup).toContain("Final batched browser check");
    expect(markup).toContain("Its own job");
    expect(markup).toContain("Review the diff");
    expect(markup).toContain("Its helper");
  });

  // Eli, 2026-10-14: five helpers read as one line, "… · and 4 more — Its helpers — 2h 10m".
  it("lists each item still running on its own row, with whose it is and how long it has run", () => {
    const items = [
      { title: "Deeper production chains + drones", of: "helper", since: Date.parse(at(1)) },
      { title: "Swarm scale toward 500k", of: "helper", since: Date.parse(at(2)) },
      { title: "Arsenal: mines, arc gates, orbital", of: "helper", since: Date.parse(at(3)) },
      { title: "Run the test suite", of: "mate", since: Date.parse(at(4)) },
      { title: "Fog of war, scanning, tech tree", of: "helper", since: Date.parse(at(5)) },
      { title: "Tone down the strike", of: "mate", since: Date.parse(at(6)) },
    ] as const;
    const markup = afterWork(after({ items, count: 7, helpers: 4 }));
    const rows = markup.match(/<li[ >]/g) ?? [];
    // Five rows of their own, and how many more run.
    expect(rows).toHaveLength(6);
    for (const item of items.slice(0, 5)) expect(markup).toContain(item.title);
    expect(markup).not.toContain("Tone down the strike");
    expect(markup).toContain("and 2 more");
    expect(markup.match(/Its helper</g)).toHaveLength(4);
    expect(markup.match(/Its own job</g)).toHaveLength(1);
    expect(markup).not.toContain(" · and ");
  });

  it.each([
    { name: "its row names nothing still running", dock: after({ items: [], count: 0 }) },
    { name: "nothing names what runs", dock: after(undefined) },
    { name: "it knows nothing of the conversation's work", dock: null },
  ])("never stands its head over nothing: $name", ({ dock }) => {
    const markup = afterWork(dock);
    expect(markup).toContain("Still working in the background");
    expect(markup).toContain("Finishing work it started");
  });
});
