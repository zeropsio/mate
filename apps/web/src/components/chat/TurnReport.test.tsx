import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AssetUrlState } from "../../assets/assetUrls";
import { ReviewContext } from "../../zerops/review";
import type { OutcomeModel, OutcomePicture } from "./conversation.logic";
import type { ResultFacts } from "./runResult.logic";
import { TimelineRowCtx, type TimelineRowSharedState } from "./timelineContext";
import { useStripFiles } from "./resultStripFiles";
import { AssetImage } from "~/assets/AssetImage";
import { TurnReport } from "./TurnReport";

/** What the workspace answers for each picture's file, by its path: loading unless told. */
const workspace = vi.hoisted(() => ({
  files: new Map<string, AssetUrlState>(),
}));

// A tile's tooltip, drawn in place of its popup: the words a pointer reads.
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
    TooltipPopup: ({ children }: { readonly children: ReactNode }) => (
      <span data-tooltip="">{children}</span>
    ),
  };
});

vi.mock("../../assets/assetUrls", () => {
  const stateOf = (path: string): AssetUrlState => workspace.files.get(path) ?? { _tag: "Loading" };
  return {
    useAssetUrlStates: (
      _environment: unknown,
      resources: ReadonlyArray<{ readonly path: string }>,
    ) => resources.map((resource) => stateOf(resource.path)),
  };
});

const at = (second: number) => new Date(Date.UTC(2026, 8, 29, 10, 0, second)).toISOString();

/** A browser check that passed and took its picture, unless told otherwise. */
const take = (key: string, overrides: Partial<ZeropsOperation> = {}): ZeropsOperation => ({
  key,
  kind: "browser",
  phase: "done",
  anchorAt: at(0),
  anchorActivityId: key,
  settledAt: at(3),
  turnId: "turn-1",
  subject: "https://appdev-1f3c-3000.prg1.example.app/status",
  kicker: "Browser · appdev",
  voice: "Checking /status",
  voiceSource: "mate",
  statusWord: "Checked",
  steps: [],
  links: [],
  callIds: [key],
  hasResult: true,
  screenshot: { src: "data:image/png;base64,iVBORw0KGgo=", width: 1440, height: 900 },
  ...overrides,
});

/** A run that left one thing of each kind the result shows, and ran commands. */
const OUTCOME: OutcomeModel = {
  key: "outcome:turn-1",
  turnKey: "turn-1",
  live: [
    {
      hostname: "appdev",
      tone: "ok",
      word: "Dev server running",
      version: null,
      url: null,
      at: at(2),
      failure: null,
    },
    {
      hostname: "appstage",
      tone: "failed",
      word: "Build failing",
      version: null,
      url: null,
      at: at(2),
      failure: { reason: "3 type errors in session.ts", at: at(2), logLines: [] },
    },
  ],
  landed: [],
  files: { count: 3, additions: 45, deletions: 3, turnId: TurnId.make("turn-1"), fromTurnId: null },
  checks: { count: 1, views: 1, failures: 0, takes: [take("op:status")] },
  pictures: [],
  created: [],
  notDone: [],
  planLeft: [],
  change: { repository: "app", number: 2 },
  crewTask: null,
  activity: [{ kind: "command", count: 2 }],
  later: { services: [], changes: [], tasks: [], pages: [], views: [], files: [], answered: false },
};

/** The forge knows the run's change, still open. */
const FACTS: ResultFacts = {
  changes: {
    groupId: "group-snap",
    open: [{ repository: "app", number: 2, title: "Add a /status page" }],
    merged: [],
    known: true,
  },
};

function render(props: Partial<Parameters<typeof TurnReport>[0]> = {}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <TurnReport
        facts={FACTS}
        onOpenImage={() => undefined}
        onOpenTurnDiff={() => undefined}
        outcome={OUTCOME}
        {...props}
      />,
    );
  });
  return renderer;
}

const markupOf = (props: Partial<Parameters<typeof TurnReport>[0]> = {}) =>
  renderToStaticMarkup(
    <TurnReport
      facts={FACTS}
      onOpenImage={() => undefined}
      onOpenTurnDiff={() => undefined}
      outcome={OUTCOME}
      {...props}
    />,
  );

const rowsOf = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === "div" && node.props["data-result-row"] !== undefined,
  );

/** The conversation the result stands in: its thread, whose workspace holds the pictures' files. */
const CONVERSATION = {
  timestampFormat: "24-hour",
  threadRef: {
    environmentId: EnvironmentId.make("env-nova"),
    threadId: ThreadId.make("thread-nova"),
  },
} as unknown as TimelineRowSharedState;

const inConversation = (node: ReactNode) => (
  <TimelineRowCtx value={CONVERSATION}>{node}</TimelineRowCtx>
);

/** A page of no service the result shows: its pictures stand in the strip under the rows. */
const DOCS = "docs.example.dev";
const APPDEV_HOST = "appdev-1f3c-3000.prg1.example.app";

const checkPicture = (
  key: string,
  caption: string,
  device: string | null = null,
  host = DOCS,
): Extract<OutcomePicture, { kind: "check" }> => ({
  kind: "check",
  key,
  src: `data:image/png;base64,${key}`,
  caption,
  page: `${host}${caption}`,
  device,
  failed: false,
  ratio: 1.6,
});

const filePicture = (name: string): Extract<OutcomePicture, { kind: "file" }> => ({
  kind: "file",
  key: `file:/var/www/app/.shots/${name}`,
  path: `/var/www/app/.shots/${name}`,
  name,
});

/** The file a picture was read from, as the workspace answers it. */
const served = (name: string) => `https://mate.example.dev/api/assets/${name}`;

function renderPictures(
  pictures: ReadonlyArray<OutcomePicture>,
  props: Partial<Parameters<typeof TurnReport>[0]> = {},
): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      inConversation(
        <TurnReport
          facts={FACTS}
          onOpenImage={() => undefined}
          onOpenTurnDiff={() => undefined}
          outcome={{ ...OUTCOME, pictures }}
          {...props}
        />,
      ),
    );
  });
  return renderer;
}

/** The strip's tiles, in order: what each is, and whether it opens. */
const tilesOf = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) =>
      (node.type === "button" || node.type === "span") &&
      node.props["data-result-picture"] !== undefined,
  );

describe("TurnReport's pictures", () => {
  beforeEach(() => {
    workspace.files = new Map(
      ["home-mobile.png", "world-mobile.png", "map-landscape.png"].map((name) => [
        `/var/www/app/.shots/${name}`,
        { _tag: "Success", url: served(name) },
      ]),
    );
  });

  // The owner, 2026-09-29, of a result that had none: "if anything it
  // should show the screenshots"; and 2026-09-30, of one picture under the
  // wrong service: "showing only one of the images". Every picture a
  // service's checks took stands under its row, in the order taken; what the
  // Mate looked at stands in one strip under the rows. Each is named by what
  // it is.
  it("draws each service's pictures under its row and the rest in a strip under the rows", () => {
    const renderer = renderPictures([
      checkPicture("op:b1", "/status", null, APPDEV_HOST),
      filePicture("home-mobile.png"),
      checkPicture("op:b2", "/", "iPhone 16", APPDEV_HOST),
    ]);
    expect(tilesOf(renderer).map((tile) => tile.props["aria-label"])).toEqual([
      "/status in the browser. Open the picture",
      "/ on iPhone 16. Open the picture",
      "home-mobile.png. Open the picture",
    ]);
    expect(
      renderer.root
        .findAll((node) => node.props["data-tooltip"] !== undefined)
        .map((tooltip) => tooltip.children.join("")),
    ).toEqual(["/status in the browser", "/ on iPhone 16", "home-mobile.png"]);
    // Both of appdev's under appdev's row, none under another's.
    expect(
      rowsOf(renderer).map((row) => [
        row.props["data-result-row"],
        row.findAll((node) => node.type === "img").length,
      ]),
    ).toContainEqual(["running", 2]);
    expect(
      rowsOf(renderer).reduce(
        (sum, row) => sum + row.findAll((node) => node.type === "img").length,
        0,
      ),
    ).toBe(2);
    const markup = renderToStaticMarkup(
      inConversation(
        <TurnReport
          facts={FACTS}
          onOpenImage={() => undefined}
          onOpenTurnDiff={() => undefined}
          outcome={{ ...OUTCOME, pictures: [filePicture("home-mobile.png")] }}
        />,
      ),
    );
    expect(markup.indexOf("Dev server running")).toBeLessThan(markup.indexOf("data-result-strip"));
  });

  it("stands six tiles at most, the sixth saying how many more", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const renderer = renderPictures(names.map((name) => checkPicture(`op:${name}`, `/${name}`)));
    const tiles = tilesOf(renderer);
    expect(tiles).toHaveLength(6);
    expect(tiles.at(-1)!.props["aria-label"]).toBe(
      "/f in the browser, and 3 more. Open the pictures",
    );
    expect(tiles.at(-1)!.findByProps({ className: "run-result-more" }).children).toEqual([
      "+",
      "3",
    ]);
    expect(
      tiles
        .slice(0, -1)
        .some(
          (tile) => tile.findAll((node) => node.props.className === "run-result-more").length > 0,
        ),
    ).toBe(false);
  });

  // The viewer holds every picture of the run, the ones past the strip's
  // sixth tile too, and opens on the one clicked.
  it.each([
    { name: "a tile", tile: 1, index: 1 },
    { name: "the last tile of a run with more", tile: 5, index: 5 },
  ])("opens the viewer on every picture of the run, from $name", ({ tile, index }) => {
    const onOpenImage = vi.fn();
    const pictures = [
      checkPicture("op:b1", "/status"),
      filePicture("home-mobile.png"),
      checkPicture("op:b2", "/cart"),
      filePicture("world-mobile.png"),
      checkPicture("op:b3", "/checkout"),
      checkPicture("op:b4", "/account"),
      filePicture("map-landscape.png"),
    ];
    const tiles = tilesOf(renderPictures(pictures, { onOpenImage }));
    act(() => tiles[tile]!.props.onClick());
    expect(onOpenImage).toHaveBeenCalledWith({
      images: [
        { src: "data:image/png;base64,op:b1", name: "/status in the browser" },
        { src: served("home-mobile.png"), name: "home-mobile.png" },
        { src: "data:image/png;base64,op:b2", name: "/cart in the browser" },
        { src: served("world-mobile.png"), name: "world-mobile.png" },
        { src: "data:image/png;base64,op:b3", name: "/checkout in the browser" },
        { src: "data:image/png;base64,op:b4", name: "/account in the browser" },
        { src: served("map-landscape.png"), name: "map-landscape.png" },
      ],
      index,
    });
  });

  // Missing files retain their tile with an explicit state; only loaded files open.
  it("keeps unavailable and loading tiles with explicit status, and the viewer skips both", () => {
    workspace.files.set("/var/www/app/.shots/world-mobile.png", { _tag: "Failure" });
    const onOpenImage = vi.fn();
    const tiles = tilesOf(
      renderPictures(
        [
          filePicture("home-mobile.png"),
          filePicture("world-mobile.png"),
          filePicture("draft-mobile.png"),
          checkPicture("op:b1", "/status"),
        ],
        { onOpenImage },
      ),
    );
    expect(
      tiles.map((tile) => [tile.type, tile.props["data-result-picture"], tile.props["aria-label"]]),
    ).toEqual([
      ["button", "ready", "home-mobile.png. Open the picture"],
      ["span", "unavailable", "world-mobile.png. Image unavailable"],
      ["span", "loading", "draft-mobile.png"],
      ["button", "ready", "/status in the browser. Open the picture"],
    ]);
    act(() => tiles[3]!.props.onClick());
    expect(onOpenImage).toHaveBeenCalledWith({
      images: [
        { src: served("home-mobile.png"), name: "home-mobile.png" },
        { src: "data:image/png;base64,op:b1", name: "/status in the browser" },
      ],
      index: 1,
    });
  });

  // A missing final tile still reaches a loaded picture beyond the strip.
  it("counts unavailable pictures in the strip and keeps the more tile readable", () => {
    workspace.files.set("/var/www/app/.shots/world-mobile.png", { _tag: "Failure" });
    const pictures = [
      ...["a", "b", "c", "d", "e"].map((name) => checkPicture(`op:${name}`, `/${name}`)),
      filePicture("world-mobile.png"),
      filePicture("map-landscape.png"),
    ];
    const onOpenImage = vi.fn();
    const tiles = tilesOf(renderPictures(pictures, { onOpenImage }));
    expect(tiles).toHaveLength(6);
    expect(tiles.at(-1)!.props["aria-label"]).toBe(
      "world-mobile.png, and 1 more. Image unavailable. Open the pictures",
    );
    // The overlay must not hide the unavailable label.
    const said = (node: ReactTestInstance): string =>
      node.children.map((child) => (typeof child === "string" ? child : said(child))).join("");
    expect(tiles.map(said).filter((words) => /\+\d/.test(words))).toEqual(["Image unavailable+1"]);
    act(() => tiles.at(-1)!.props.onClick());
    expect(onOpenImage.mock.calls[0]?.[0].index).toBe(5);
    expect(onOpenImage.mock.calls[0]?.[0].images[5].src).toBe(served("map-landscape.png"));
  });

  // The opened card leaves the first six files to the strip, including missing ones.
  it("hands the card the files its strip draws", () => {
    workspace.files.set("/var/www/app/.shots/world-mobile.png", { _tag: "Failure" });
    const names = [
      "home-mobile.png",
      "world-mobile.png",
      "a.png",
      "b.png",
      "c.png",
      "d.png",
      "e.png",
    ];
    renderPictures(names.map(filePicture));
    const seen: Array<ReadonlyArray<string>> = [];
    function Card() {
      seen.push([...useStripFiles(OUTCOME.turnKey, new Set())]);
      return null;
    }
    act(() => {
      create(<Card />);
    });
    expect(seen.at(-1)).toEqual(names.slice(0, 6).map((name) => `/var/www/app/.shots/${name}`));
  });

  // Even when every file is gone the strip explains why.
  it.each([
    { name: "under the result rows", live: OUTCOME.live, report: true },
    {
      name: "with no other result row",
      live: [] as OutcomeModel["live"],
      report: false,
    },
  ])("shows explicit unavailable tiles when every image is gone: $name", ({ live, report }) => {
    workspace.files.set("/var/www/app/.shots/world-mobile.png", { _tag: "Failure" });
    workspace.files.set("/var/www/app/.shots/map-landscape.png", { _tag: "Failure" });
    const renderer = renderPictures(
      [filePicture("world-mobile.png"), filePicture("map-landscape.png")],
      {
        outcome: {
          ...OUTCOME,
          ...(report ? {} : { live, change: null, checks: null }),
          pictures: [filePicture("world-mobile.png"), filePicture("map-landscape.png")],
        },
      },
    );
    expect(tilesOf(renderer).map((tile) => tile.props["data-result-picture"])).toEqual([
      "unavailable",
      "unavailable",
    ]);
    expect(
      renderer.root.findAll((node) => node.props["data-result-strip"] !== undefined),
    ).toHaveLength(1);
    expect(
      renderer.root.findAll((node) => node.props["data-turn-report"] !== undefined).length > 0,
    ).toBe(true);
  });

  it("shows the owner's missing-file reason and marks failed bytes unavailable", () => {
    workspace.files.set("/var/www/app/.shots/world-mobile.png", {
      _tag: "Failure",
      reason: "File no longer exists",
    });
    const renderer = renderPictures([
      filePicture("home-mobile.png"),
      filePicture("world-mobile.png"),
    ]);
    expect(JSON.stringify(renderer.toJSON())).toContain("File no longer exists");
    const img = tilesOf(renderer)[0]!.findByType("img");
    act(() => img.props.onError({ currentTarget: {} }));
    expect(tilesOf(renderer).map((tile) => tile.props["data-result-picture"])).toEqual([
      "unavailable",
      "unavailable",
    ]);
    expect(renderer.root.findAllByType("img")).toHaveLength(0);
  });

  // Each tile takes its picture's shape at the strip's one height, from its
  // first frame (the owner, 2026-09-29: "why these has different ration
  // than the result?"): a check's from the check, a file's from the size the
  // workspace read off its header with its address; one still being read,
  // a desktop's room.
  it("stands each tile in its picture's own shape before the picture loads", () => {
    const shot = (name: string, width: number, height: number): AssetUrlState => ({
      _tag: "Success",
      url: served(name),
      imageDimensions: { width, height },
    });
    workspace.files = new Map([
      ["/var/www/app/.shots/map-landscape.png", shot("map-landscape.png", 844, 390)],
      ["/var/www/app/.shots/full-page.png", shot("full-page.png", 1440, 5200)],
    ]);
    const tiles = tilesOf(
      renderPictures([
        { ...checkPicture("op:b1", "/"), device: "iPhone 16", ratio: 1179 / 2556 },
        checkPicture("op:b2", "/status"),
        filePicture("map-landscape.png"),
        filePicture("full-page.png"),
        filePicture("draft-mobile.png"),
      ]),
    );
    expect(tiles.map((tile) => Number(tile.props.style.aspectRatio.toFixed(3)))).toEqual([
      0.461, 1.6, 2.164, 0.45, 1.6,
    ]);
    expect(tiles.map((tile) => tile.props["data-result-picture"])).toEqual([
      "ready",
      "ready",
      "ready",
      "ready",
      "loading",
    ]);
  });

  it("reserves a captured file's known shape while its bytes are unread", () => {
    workspace.files = new Map();
    const [tile] = tilesOf(
      renderPictures([
        { ...filePicture("home-mobile.png"), dimensions: { width: 1179, height: 2556 } },
      ]),
    );
    expect(tile!.props.style.aspectRatio).toBeCloseTo(1179 / 2556, 6);
  });

  it("keeps a file's reserved shape when its address came without its size", () => {
    workspace.files = new Map([
      ["/var/www/app/.shots/home-mobile.svg", { _tag: "Success", url: served("home-mobile.svg") }],
    ]);
    const renderer = renderPictures([filePicture("home-mobile.svg")]);
    const [tile] = tilesOf(renderer);
    expect(tile!.props.style.aspectRatio).toBe(1.6);
    const picture = tile!.find((node) => node.type === "img");
    act(() =>
      picture.props.onLoad?.({ currentTarget: { naturalWidth: 1179, naturalHeight: 2556 } }),
    );
    expect(tilesOf(renderer)[0]!.props.style.aspectRatio).toBe(1.6);
  });

  it("is the whole result when the run left no row", () => {
    const renderer = renderPictures([filePicture("home-mobile.png")], {
      outcome: {
        ...OUTCOME,
        live: [],
        change: null,
        checks: null,
        pictures: [filePicture("home-mobile.png")],
      },
    });
    expect(rowsOf(renderer)).toEqual([]);
    expect(tilesOf(renderer)).toHaveLength(1);
  });

  // T5: the strip rises with the rows, last, when the run finished while the
  // person watched.
  it("rises last, after the rows, when watched", () => {
    const renderer = renderPictures([filePicture("home-mobile.png")], { settling: true });
    const strip = renderer.root.find(
      (node) => node.type === "div" && node.props.className === "run-result-pictures",
    );
    expect([strip.props["data-rising"], strip.props.style?.["--row-index"]]).toEqual([true, 3]);
  });
});

describe("TurnReport", () => {
  // Rows in the card's grid, most important first (K5): what is still
  // broken, then what waits for the person, then what runs.
  it("stands its rows broken, then waiting for you, then running", () => {
    expect(rowsOf(render()).map((row) => row.props["data-result-row"])).toEqual([
      "broken",
      "waiting",
      "running",
    ]);
    const markup = markupOf();
    expect(markup.indexOf("appstage")).toBeLessThan(markup.indexOf("#2 Add a /status page"));
    expect(markup.indexOf("#2 Add a /status page")).toBeLessThan(
      markup.indexOf("Dev server running"),
    );
  });

  // What its calls came to is the work's, and the worked line's (K6): the
  // result never counts them again.
  it("counts no calls: the pills are gone", () => {
    const markup = markupOf();
    expect(markup).not.toContain("2 commands");
    expect(markup).not.toContain("data-pill");
    expect(markup).not.toContain("rounded-full");
  });

  it("draws nothing at all when the run left nothing open or running", () => {
    expect(markupOf({ outcome: { ...OUTCOME, live: [], change: null, checks: null } })).toBe("");
  });

  // Red is only what is still broken (S3): its mark and its name.
  it.each([
    { title: "appstage", mark: "alert", tone: "failed", broken: true },
    { title: "#2 Add a /status page", mark: "change", tone: "muted", broken: false },
    { title: "appdev", mark: "dot", tone: "ok", broken: false },
  ])("marks $title in its tone", ({ title, mark, tone, broken }) => {
    const row = rowsOf(render()).find(
      (candidate) => candidate.findAll((node) => node.children.includes(title)).length > 0,
    )!;
    const glyph = row.find((node) => node.props["data-result-mark"] !== undefined);
    expect([glyph.props["data-result-mark"], glyph.props["data-tone"]]).toEqual([mark, tone]);
    const name = row.find((node) => node.type === "span" && node.children.includes(title));
    expect(name.props["data-broken"] === true).toBe(broken);
  });

  // One door (R1): Review opens the review of the change, from the word.
  it("reviews the change through the one door", () => {
    const openReview = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ReviewContext value={openReview}>
          <TurnReport
            facts={FACTS}
            onOpenImage={() => undefined}
            onOpenTurnDiff={() => undefined}
            outcome={OUTCOME}
          />
        </ReviewContext>,
      );
    });
    const review = renderer.root.find(
      (node) => node.type === "button" && node.children.includes("Review"),
    );
    const from = { tagName: "BUTTON" };
    act(() => review.props.onClick({ currentTarget: from }));
    expect(openReview).toHaveBeenCalledWith(
      { kind: "change", groupId: "group-snap", repository: "app", number: 2 },
      { from },
    );
  });

  it("opens the run's own diff from the files it changed", () => {
    const onOpenTurnDiff = vi.fn();
    const files = render({ onOpenTurnDiff }).root.find(
      (node) => node.type === "button" && node.children.includes("3 files"),
    );
    act(() => files.props.onClick());
    expect(onOpenTurnDiff).toHaveBeenCalledWith(TurnId.make("turn-1"), null);
  });

  // A service that stopped since comes back in red, saying since when.
  it("says since when a service is broken", () => {
    const markup = markupOf({
      outcome: { ...OUTCOME, live: [OUTCOME.live[0]!], change: null, checks: null },
      facts: {
        services: new Map([["appdev", { status: "STOPPED", since: at(50), versionAt: null }]]),
      },
    });
    expect(markup).toContain("Stopped");
    expect(markup).toMatch(/>Since [^<]+</);
  });

  // S6: the fix goes to one of the person's own Mates; outside a Zerops
  // session there is none to ask, and the row offers nothing rather than a
  // button that does nothing.
  it("offers no fix where no Mate can be asked", () => {
    const markup = markupOf({ facts: { ...FACTS, mate: { projectId: "p-nova", groupId: "g" } } });
    expect(markup).toContain("Build failing");
    expect(markup).not.toContain("to fix it");
  });

  // T5: the result arriving is the moment worth seeing — once, row by row,
  // 40 ms apart, and only when the run finished while the person watched.
  it.each([
    { settling: true, rising: [true, true, true], order: [0, 1, 2] },
    { settling: false, rising: [false, false, false], order: [undefined, undefined, undefined] },
  ])("rises in row by row only when watched: settling $settling", ({ settling, rising, order }) => {
    const rows = rowsOf(render({ settling }));
    expect(rows.map((row) => row.props["data-rising"] === true)).toEqual(rising);
    expect(rows.map((row) => row.props.style?.["--row-index"])).toEqual(order);
  });

  // Once means once: a row whose rise ended never replays it when it moves
  // later — appdev stopping tonight moves it up to the broken rows, and React
  // moving its node would start a rise it still declared all over again.
  it("never replays a row's rise once it ended, when the row moves", () => {
    const renderer = render({ settling: true });
    for (const row of rowsOf(renderer)) {
      const node = { row: row.props["data-result-row"] };
      act(() => row.props.onAnimationEnd({ target: node, currentTarget: node }));
    }
    expect(rowsOf(renderer).map((row) => row.props["data-rising"] === true)).toEqual([
      false,
      false,
      false,
    ]);
    act(() =>
      renderer.update(
        <TurnReport
          facts={{
            ...FACTS,
            services: new Map([
              ["appdev", { status: "STOPPED", since: at(50), versionAt: null }],
              ["appstage", { status: "ACTIVE", since: at(0), versionAt: null }],
            ]),
          }}
          onOpenImage={() => undefined}
          onOpenTurnDiff={() => undefined}
          outcome={OUTCOME}
          settling
        />,
      ),
    );
    const moved = rowsOf(renderer);
    expect(moved.map((row) => row.props["data-result-row"])).toEqual([
      "broken",
      "broken",
      "waiting",
    ]);
    expect(moved.some((row) => row.props["data-rising"] === true)).toBe(false);
  });

  // Only what the result arrived with rises: a row that turns up later —
  // the forge naming the change a moment after — is simply there.
  it("rises only the rows the result arrived with", () => {
    const arrived: ResultFacts = { ...FACTS, changes: { ...FACTS.changes!, open: [] } };
    const renderer = render({ settling: true, facts: arrived });
    expect(rowsOf(renderer).map((row) => row.props["data-rising"] === true)).toEqual([true, true]);
    act(() =>
      renderer.update(
        <TurnReport
          facts={FACTS}
          onOpenImage={() => undefined}
          onOpenTurnDiff={() => undefined}
          outcome={OUTCOME}
          settling
        />,
      ),
    );
    const change = rowsOf(renderer).find((row) => row.props["data-result-row"] === "waiting");
    expect(change?.props["data-rising"]).toBeUndefined();
  });
});

it("the result strip and original viewer resolve a captured tool picture by reference", () => {
  const src = "mate-asset:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const source = "mate-image:reference";
  workspace.files.set(src, { _tag: "Success", url: source });
  const open = vi.fn();
  const renderer = renderPictures([{ ...checkPicture("captured", "/", null, APPDEV_HOST), src }], {
    onOpenImage: open,
  });
  const tile = tilesOf(renderer)[0]!;
  expect(tile.findByType(AssetImage).props.src).toBe(source);
  act(() => tile.props.onClick());
  expect(open.mock.calls[0]?.[0].images[0].src).toBe(source);
  act(() => renderer.unmount());
});
