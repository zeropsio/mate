// @vitest-environment happy-dom
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import { EnvironmentId, type ZeropsLease, type ZeropsLifecycle } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { Atom } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useAddressesSheet } from "~/zerops/addressesSheet";
import type { FixProblem } from "~/zerops/fixRequest";
import {
  placeAddresses as place,
  withPlaceAddresses as inAccount,
} from "~/zerops/__fixtures__/placeAddresses";

import type { HeadingLineInput } from "./SidebarHeadingLine.logic";
import type { ChipMenuModel, ChipMenuStop, ProductionChip } from "./SidebarProductionChip.logic";
import {
  HeaderSites,
  ProjectSites,
  type ProjectSitesInput,
  type SitesMate,
} from "./SidebarProjectSites";

/** Every request a part's "Ask <Mate> to start it" wrote. */
const asked = vi.hoisted(() => [] as Array<readonly unknown[]>);
vi.mock("~/zerops/useAskMate", () => ({
  useAskMate:
    () =>
    (...args: unknown[]) => {
      asked.push(args);
    },
}));

vi.mock("~/zerops/accountForge", () => ({
  useStopDeploymentDemand: () => {},
  useStopDeployments: () => new Map(),
}));

/** zcp's leases as each conversation's lifecycle last read them, by the conversation's scoped key. */
const lifecycles = vi.hoisted(() => new Map<string, ReadonlyArray<unknown>>());
vi.mock("~/zerops/feeds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/zerops/feeds")>();
  return {
    zeropsFeeds: {
      ...actual.zeropsFeeds,
      lifecycle: ({
        environmentId,
        input,
      }: {
        readonly environmentId: string;
        readonly input: { readonly threadId: string };
      }) => {
        const leases = lifecycles.get(`${environmentId}:${input.threadId}`);
        return Atom.make(
          (leases === undefined
            ? { state: "unread", waitingFor: null }
            : {
                state: "known",
                value: {
                  threadId: input.threadId,
                  recentTools: [],
                  envelope: {
                    phase: "develop-active",
                    environment: "container",
                    project: { id: "quill-kara", name: "Kara" },
                    services: [],
                    leases,
                    generated: "2026-10-25T09:00:00Z",
                  },
                },
              }) as unknown as Known<ZeropsLifecycle>,
        );
      },
    },
  };
});

const route = (service: string, host: string, port = 80): ZeropsPublicRoute => ({
  service,
  port,
  host,
  url: `https://${host}`,
});

const PROBLEM: FixProblem = {
  what: "Production is down",
  at: undefined,
  error: undefined,
  ask: "Find out why and bring it back.",
};

const stop = (over: Partial<ChipMenuStop> & Pick<ChipMenuStop, "name">): ChipMenuStop => ({
  projectId: `quill-${over.name}`,
  version: undefined,
  dot: "ok",
  word: "Healthy",
  tone: "muted",
  note: undefined,
  fix: undefined,
  routes: [],
  ...over,
});

/** A Mate of the project `quill`, whose it is as given. */
function mate(
  name: string,
  over: {
    readonly mine?: boolean;
    readonly owner?: SitesMate["owner"];
    readonly routes?: ReadonlyArray<ZeropsPublicRoute> | undefined;
    /** Its project's services as listed, with the dev pools among them. */
    readonly services?: {
      readonly hostnames: ReadonlyArray<string>;
      readonly pools: ReadonlyArray<string>;
    };
    /** Its conversation the person last visited, by scoped key. */
    readonly threadKey?: string | undefined;
  } = {},
): SitesMate {
  const id = `quill-${name.toLowerCase()}`;
  return {
    candidate: {
      key: `${id}:zcp`,
      project: {
        id,
        name,
        status: "ACTIVE",
        tagList: ["mate"],
        hq: { appId: "quill", appName: "Quillmark", kind: "mate", mate: { face: "" } },
      },
      group: "connected",
      environmentId: EnvironmentId.make(`env-${id}`),
      service: { id: "zcp", name: "zcp", status: "ACTIVE" },
      ...("routes" in over
        ? over.routes === undefined
          ? {}
          : { routes: over.routes }
        : {
            routes: [route("appdev", `${id}.example.app`)],
          }),
      ...(over.services === undefined ? {} : { services: over.services }),
    },
    tint: "sky",
    shape: MATE_SHAPE_OF_TINT.sky,
    mine: over.mine ?? true,
    threadKey: over.threadKey,
    name,
    owner: over.owner,
  };
}

const HEALTHY: ProductionChip = { label: "prod", state: "ok", version: "v2.3.0" };

const PRODUCTION: ChipMenuModel = {
  stops: [
    stop({
      name: "production",
      version: "v2.3.0",
      routes: [route("app", "quill.example.com"), route("api", "api.quill.example.com")],
    }),
  ],
};
const STAGES: ChipMenuModel = {
  stops: [stop({ name: "stage", routes: [route("app", "stage.quill.example.app")] })],
};

const CALM: HeadingLineInput = {
  production: { projectId: "quill-production", chip: HEALTHY, coming: undefined, building: false },
  stages: [
    { projectId: "quill-stage", name: "stage", coming: undefined, serves: true, building: false },
  ],
};

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  lifecycles.clear();
  asked.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAddressesSheet.getState().close();
});

async function mount(
  over: Partial<ProjectSitesInput> = {},
  wrap: (children: ReactNode) => ReactNode = (children) => children,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props: ProjectSitesInput = {
    groupId: "quill",
    projectName: "Quillmark",
    production: () => PRODUCTION,
    stages: () => STAGES,
    mates: [mate("Nell"), mate("Odo", { mine: false, owner: owner("Pia Lund") })],
    prodChip: HEALTHY,
    stageChip: { label: "stage", state: "ok", version: "main" },
    line: CALM,
    onAskToFix: undefined,
    onOpenStop: () => undefined,
    ...over,
  };
  await act(async () => {
    root.render(
      wrap(
        <ProjectSites {...props}>
          {({ tag, globe }) => (
            <div data-row="">
              {tag}
              {globe}
            </div>
          )}
        </ProjectSites>,
      ),
    );
  });
  unmounts.push(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  return container;
}

function owner(name: string): NonNullable<SitesMate["owner"]> {
  return { name, initials: name.slice(0, 1), avatarUrl: null, isViewer: false };
}

const surface = (name: string) =>
  document.querySelector<HTMLElement>(`[data-zerops-surface="${name}"]`);
const surfaces = (name: string) => [
  ...document.querySelectorAll<HTMLElement>(`[data-zerops-surface="${name}"]`),
];

async function press(element: HTMLElement | null, init: MouseEventInit = {}) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  });
}

/** Each section by its title, with the hosts it lists. */
const listed = () =>
  [...document.querySelectorAll<HTMLElement>("[data-sites-section]")]
    .filter((section) => !section.hidden)
    .map((section) => [
      section.getAttribute("aria-label"),
      [...section.querySelectorAll('[data-zerops-surface="sidebar-project-sites-link"]')].map(
        (link) => link.getAttribute("href"),
      ),
    ]);

describe("the project's addresses", () => {
  it("offers the project's own page beside its addresses, and opens it", async () => {
    const opened = vi.fn();
    await mount({ onOpenPage: opened });
    const door = surface("sidebar-project-page");
    expect(door?.getAttribute("aria-label")).toBe("Quillmark's page");
    expect(door?.nextElementSibling).toBe(surface("sidebar-project-sites"));
    await press(door);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("the globe opens a popover that lists production's, each stage's and every Mate's addresses", async () => {
    await mount();
    const globe = surface("sidebar-project-sites");
    expect(globe?.getAttribute("aria-label")).toBe("Addresses of Quillmark");
    await press(globe);
    expect(surface("sidebar-project-sites-popover")).not.toBeNull();
    expect(listed()).toEqual([
      ["Production", ["https://quill.example.com", "https://api.quill.example.com"]],
      ["Main", ["https://stage.quill.example.app"]],
      ["Nell", ["https://quill-nell.example.app"]],
      ["Odo", ["https://quill-odo.example.app"]],
    ]);
    expect(globe?.hasAttribute("data-popup-open")).toBe(true);
    const link = surface("sidebar-project-sites-link");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
  });

  it("says whose a colleague's Mate is", async () => {
    await mount();
    await press(surface("sidebar-project-sites"));
    const heads = surfaces("sidebar-project-sites-mate").map((head) => head.textContent ?? "");
    expect(heads[0]).toBe("Nell");
    expect(heads[1]).toContain("Odo · Pia's");
  });

  it("says it is reading a Mate not read yet, never that it has none", async () => {
    await mount({ mates: [mate("Nell", { routes: undefined })] });
    await press(surface("sidebar-project-sites"));
    expect(surface("sidebar-project-sites-reading")?.textContent).toBe("Reading…");
  });

  it("says there is no public address yet where nothing has one, and offers Zerops", async () => {
    await mount({
      production: undefined,
      stages: undefined,
      line: undefined,
      mates: [mate("Nell", { routes: [] })],
    });
    const globe = surface("sidebar-project-sites");
    expect(globe?.hasAttribute("data-empty")).toBe(true);
    await press(globe);
    expect(surface("sidebar-project-sites-empty")?.textContent).toContain(
      "No public addresses yet",
    );
    expect(surface("sidebar-production-zerops")?.getAttribute("href")).toBe(
      "https://app.zerops.io/project/quill-nell",
    );
  });

  it("copies an address from its row and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount();
    await press(surface("sidebar-project-sites"));
    const copy = surface("sidebar-project-sites-copy");
    expect(copy?.getAttribute("aria-label")).toBe("Copy quill.example.com");
    await press(copy);
    expect(writeText).toHaveBeenCalledWith("https://quill.example.com");
    expect(surface("sidebar-project-sites-copy")?.textContent).toBe("Copied");
  });

  it("copies the focused address on c", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount();
    await press(surface("sidebar-project-sites"));
    const links = surfaces("sidebar-project-sites-link");
    await act(async () => {
      links[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith("https://api.quill.example.com");
  });

  it("opens production's first address in a new tab on a ⌘-click, without the popover", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await mount({
      production: () => ({
        stops: [stop({ name: "production", routes: [route("app", "quill.example.com")] })],
      }),
    });
    await press(surface("sidebar-project-sites"), { metaKey: true });
    expect(open).toHaveBeenCalledWith("https://quill.example.com", "_blank", "noopener,noreferrer");
    expect(surface("sidebar-project-sites-popover")).toBeNull();
  });

  it("a ⌘-click on a production of several addresses opens their list instead of the first", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await mount();
    await press(surface("sidebar-project-sites"), { metaKey: true });
    expect(open).not.toHaveBeenCalled();
    expect(surface("sidebar-project-sites-popover")).not.toBeNull();
    expect(listed()[0]).toEqual([
      "Production",
      ["https://quill.example.com", "https://api.quill.example.com"],
    ]);
  });

  it("offers a filter over more than eight addresses, and Esc clears it before it closes", async () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      route(`svc${String(index)}`, `svc${String(index)}.quill.example.com`),
    );
    await mount({
      production: () => ({ stops: [stop({ name: "production", routes: many })] }),
    });
    await press(surface("sidebar-project-sites"));
    const filter = document.querySelector<HTMLInputElement>("[data-sites-filter]");
    expect(filter?.getAttribute("aria-label")).toBe("Filter addresses");
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(filter, "odo");
      filter?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(listed()).toEqual([["Odo", ["https://quill-odo.example.app"]]]);
    await act(async () => {
      filter?.focus();
      filter?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(surface("sidebar-project-sites-popover")).not.toBeNull();
    expect(listed()).toHaveLength(4);
  });

  it("says when nothing matches the filter", async () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      route(`svc${String(index)}`, `svc${String(index)}.quill.example.com`),
    );
    await mount({ production: () => ({ stops: [stop({ name: "production", routes: many })] }) });
    await press(surface("sidebar-project-sites"));
    const filter = document.querySelector<HTMLInputElement>("[data-sites-filter]");
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(filter, "nowhere");
      filter?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(surface("sidebar-project-sites-nomatch")?.textContent).toBe(
      "No address matches “nowhere”",
    );
  });

  it("offers the fix to the viewer's own Mate only, and writes it into that Mate", async () => {
    const ask = vi.fn();
    await mount({
      production: () => ({
        stops: [
          stop({ name: "production", dot: "failed", word: "Down", tone: "red", fix: PROBLEM }),
        ],
      }),
      mates: [mate("Odo", { mine: false, owner: owner("Pia Lund") }), mate("Nell")],
      onAskToFix: ask,
    });
    await press(surface("sidebar-project-sites"));
    expect(surface("sidebar-production-ask-button")?.textContent).toBe("Ask Nell to fix it");
    await press(surface("sidebar-production-ask-button"));
    await press(surface("sidebar-production-ask-open"));
    expect(ask).toHaveBeenCalledWith("quill-nell", PROBLEM);
    expect(surface("sidebar-project-sites-popover")).toBeNull();
  });
});

/** A pool declaring three slots' ports, each with its own subdomain whether or not a container holds it. */
const slots = (pool: string) =>
  [3001, 3002, 3003].map((port) => route(pool, `${pool}-${String(port)}.quill.example.app`, port));

/** A lease zcp holds, as its envelope names it. */
const held = (alias: string, branch: string, over: Partial<ZeropsLease> = {}) => ({
  alias,
  pool: alias.slice(0, alias.lastIndexOf("-")),
  branch,
  state: "held",
  acquiredAt: "2026-10-25T08:00:00Z",
  ...over,
});

/** Kara, whose project holds two dev pools of three slots each and a stage. */
const kara = (threadKey: string | undefined) =>
  mate("Kara", {
    routes: [
      ...slots("embedderpool"),
      ...slots("hqpool"),
      route("appstage", "kara-stage.example.app"),
    ],
    services: {
      hostnames: ["appstage", "embedderpool", "hqpool"],
      pools: ["embedderpool", "hqpool"],
    },
    threadKey,
  });

const EMBEDDER_URL = "https://embedderpool-c2e4-8101.prg1.zerops.app";

/**
 * The leases of Kara's two branches, as a status call read them: one running its preview, one
 * parked, one with none yet, one ended — each with what a release would lose there.
 */
const KARA_LEASES = [
  held("embedderpool-7", "feat-x", {
    devServers: [
      {
        name: "web",
        port: 8101,
        url: EMBEDDER_URL,
        status: "running",
        readAt: "2026-10-25T09:00:00Z",
      },
    ],
    activity: {
      lastChangeAt: "2026-10-25T08:30:00Z",
      previewOpenConns: 0,
      acquiredAt: "2026-10-25T08:00:00Z",
      readAt: "2026-10-25T09:00:00Z",
    },
    unsaved: { fileCount: 2, unpushedCommits: 1 },
  }),
  held("hqpool-3", "feat-x", { state: "parked" }),
  held("hqpool-4", "feat-y"),
  held("embedderpool-5", "gone", { state: "lost" }),
];

/** Each part row of the open popover's works: what it says, and the preview it opens. */
const parts = () =>
  surfaces("sidebar-project-sites-part").map((row) => ({
    text: row.textContent,
    href: row.querySelector("a")?.getAttribute("href") ?? row.getAttribute("href"),
  }));

/** The words of the open popover's Kara section. */
const karaSays = () =>
  document.querySelector<HTMLElement>('[data-sites-section="mate:quill-kara"]')?.textContent ?? "";

/** What a person must never be shown of a workspace: zcp's lease, its container, its holder. */
const WORKSPACE_WORDS = [
  "pool ·",
  "embedderpool-7",
  "hqpool",
  "feat-x",
  "parked",
  "no preview yet",
  "Held",
  "this chat",
  "unpushed",
  "uncommitted",
  "last active",
  "idle",
  "Release",
];

describe("a Mate's dev pools", () => {
  it("a Mate's Sites list each part's preview by the part's name, and nothing about its workspace", async () => {
    lifecycles.set("env-kara:thread-kara", KARA_LEASES);
    await mount({
      production: undefined,
      stages: undefined,
      line: undefined,
      mates: [kara("env-kara:thread-kara")],
    });
    await press(surface("sidebar-project-sites"));
    expect(listed()).toEqual([
      ["Main", ["https://kara-stage.example.app"]],
      ["Kara", []],
    ]);
    expect(parts()).toEqual([
      { text: "Embedderrunningembedderpool-c2e4-8101.prg1.zerops.app", href: EMBEDDER_URL },
      { text: "HQpausedAsk Kara to start it", href: null },
      { text: "HQ", href: null },
    ]);
    for (const word of WORKSPACE_WORDS) expect(karaSays(), word).not.toContain(word);
    expect(
      surface("sidebar-project-sites-popover")?.querySelector(".zerops-sites-count")?.textContent,
    ).toBe("2 addresses");
  });

  it("the header's Sites read the Mate's workspaces from the conversation it is in", async () => {
    lifecycles.set("env-kara:thread-open", KARA_LEASES);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const sites: ProjectSitesInput = {
      groupId: "quill",
      projectName: "Quillmark",
      production: undefined,
      stages: undefined,
      mates: [kara(undefined)],
      prodChip: undefined,
      stageChip: undefined,
      line: undefined,
      onAskToFix: undefined,
      onOpenStop: () => undefined,
    };
    await act(async () => {
      root.render(
        <HeaderSites
          mateProjectId="quill-kara"
          sites={sites}
          threadKey="env-kara:thread-open"
          trigger={<button data-trigger="" type="button" />}
        >
          Sites
        </HeaderSites>,
      );
    });
    unmounts.push(() => {
      act(() => {
        root.unmount();
      });
      container.remove();
    });
    await press(document.querySelector<HTMLElement>("[data-trigger]"));
    expect(parts().map((part) => part.href)).toEqual([EMBEDDER_URL, null, null]);
  });

  it('A part not running offers "Ask <Mate> to start it", which fills the composer and doesn\'t send', async () => {
    lifecycles.set("env-kara:thread-asks", KARA_LEASES);
    await mount({
      production: undefined,
      stages: undefined,
      line: undefined,
      mates: [kara("env-kara:thread-asks")],
    });
    await press(surface("sidebar-project-sites"));
    const ask = [...document.querySelectorAll<HTMLElement>("button")].find(
      (button) => button.textContent === "Ask Kara to start it",
    );
    await press(ask ?? null);
    expect(asked).toEqual([
      [
        "quill-kara",
        "Start the HQ preview.",
        { send: false, branch: "feat-x", repositoryUrl: undefined },
      ],
    ]);
    expect(surface("sidebar-project-sites-popover"), "the Sites close for the composer").toBeNull();
  });

  it("offers no start to a person who does not operate the Mate", async () => {
    lifecycles.set("env-kara:thread-colleague", KARA_LEASES);
    await mount({
      production: undefined,
      stages: undefined,
      line: undefined,
      mates: [{ ...kara("env-kara:thread-colleague"), mine: false, owner: owner("Pia Lund") }],
    });
    await press(surface("sidebar-project-sites"));
    expect(parts().map((part) => part.text)).toContain("HQpaused");
    expect(document.body.textContent).not.toContain("to start it");
  });

  it("the globe never says there is no address while a Mate's pools hold workspaces not read yet", async () => {
    await mount({
      production: undefined,
      stages: undefined,
      line: undefined,
      mates: [
        mate("Kara", {
          routes: slots("webpool"),
          services: { hostnames: ["webpool"], pools: ["webpool"] },
        }),
      ],
    });
    expect(surface("sidebar-project-sites")?.hasAttribute("data-empty")).toBe(false);
  });
});

/** The header's Sites of Kara's conversation, opened. */
async function openHeaderSites() {
  lifecycles.set("env-kara:thread-asks", KARA_LEASES);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const sites: ProjectSitesInput = {
    groupId: "quill",
    projectName: "Quillmark",
    production: undefined,
    stages: undefined,
    mates: [kara(undefined)],
    prodChip: undefined,
    stageChip: undefined,
    line: undefined,
    onAskToFix: undefined,
    onOpenStop: () => undefined,
  };
  await act(async () => {
    root.render(
      <HeaderSites
        mateProjectId="quill-kara"
        sites={sites}
        threadKey="env-kara:thread-asks"
        trigger={<button data-trigger="" type="button" />}
      >
        Sites
      </HeaderSites>,
    );
  });
  unmounts.push(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  await press(document.querySelector<HTMLElement>("[data-trigger]"));
}

// Aleš, 2026-10-27: a person never manages leases; releasing one is the Mate's own tool.
describe("a Mate's workspaces", () => {
  it("no surface offers a person a workspace's Release", async () => {
    await openHeaderSites();
    const buttons = () =>
      [...document.querySelectorAll("button")].map(
        (button) => `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`,
      );
    expect(buttons().filter((said) => /release/iu.test(said))).toEqual([]);
    for (const word of WORKSPACE_WORDS) expect(karaSays(), word).not.toContain(word);
    // And the menu's globe, which opens the same Sites from the project's row.
    lifecycles.set("env-kara:thread-kara", KARA_LEASES);
    await mount({
      production: undefined,
      stages: undefined,
      line: undefined,
      mates: [kara("env-kara:thread-kara")],
    });
    await press(surface("sidebar-project-sites"));
    expect(buttons().filter((said) => /release/iu.test(said))).toEqual([]);
  });
});

describe("the environment tag", () => {
  it("is not there while every place is calm", async () => {
    await mount();
    expect(surface("sidebar-project-env-tag")).toBeNull();
  });

  it("says the sentence and opens the popover at the section it speaks of", async () => {
    await mount({
      prodChip: { label: "prod", state: "ok", version: "v2.3.0" },
      line: {
        ...CALM,
        stages: [
          {
            projectId: "quill-stage",
            name: "stage",
            coming: { kind: "failed", reason: "the build exited 2" },
            serves: false,
            building: false,
          },
        ],
      },
    });
    const tag = surface("sidebar-project-env-tag");
    expect(tag?.textContent).toBe("Didn’t come up");
    expect(tag?.getAttribute("aria-label")).toBe("Stage didn’t come up · the build exited 2");
    await press(tag);
    expect(surface("sidebar-project-sites-popover")).not.toBeNull();
    expect(document.querySelector("[data-flash]")?.getAttribute("data-sites-section")).toBe(
      "stage:stage",
    );
    expect(tag?.hasAttribute("data-popup-open")).toBe(true);
  });
});

describe("the addresses sheet's doors", () => {
  const sectionOf = (title: string) =>
    [...document.querySelectorAll<HTMLElement>("[data-sites-section]")].find(
      (section) => section.getAttribute("aria-label") === title,
    );
  const manageIn = (title: string) =>
    sectionOf(title)?.querySelector<HTMLElement>(
      '[data-zerops-surface="sidebar-project-sites-manage"]',
    ) ?? null;
  const addDomain = () => surface("sidebar-project-sites-add-domain");

  it.each([
    ["Production", "quill-production"],
    ["Main", "quill-stage"],
    ["Nell", "quill-nell"],
  ])(
    "Manage on %s's head opens the addresses sheet for its project and closes the popover",
    async (title, projectId) => {
      await mount({}, inAccount({}));
      await press(surface("sidebar-project-sites"));
      await press(manageIn(title));
      expect(useAddressesSheet.getState().target).toEqual({
        orgId: "org",
        projectId,
        groupId: "quill",
      });
      expect(surface("sidebar-project-sites-popover")).toBeNull();
    },
  );

  it("offers no Manage for a place Git delivers to, which has no Zerops addresses", async () => {
    await mount(
      {
        production: () => ({
          stops: [
            // Delivered by Git: only that it is, not how, matters here.
            stop({ name: "production", git: {} as unknown as NonNullable<ChipMenuStop["git"]> }),
          ],
        }),
      },
      inAccount({}),
    );
    await press(surface("sidebar-project-sites"));
    expect(sectionOf("Production")).toBeDefined();
    expect(manageIn("Production")).toBeNull();
    expect(manageIn("Main")).not.toBeNull();
  });

  it("offers no Manage outside an account, where no sheet can read a place", async () => {
    await mount();
    await press(surface("sidebar-project-sites"));
    expect(surfaces("sidebar-project-sites-manage")).toEqual([]);
  });

  it("Put it on your domain shows in production's section only while production has no domain of its own, and opens the sheet to add one", async () => {
    await mount({}, inAccount({ "quill-production": place([]), "quill-stage": place([]) }));
    await press(surface("sidebar-project-sites"));
    expect(surfaces("sidebar-project-sites-add-domain")).toHaveLength(1);
    expect(sectionOf("Production")?.contains(addDomain())).toBe(true);
    await press(addDomain());
    expect(useAddressesSheet.getState().target).toEqual({
      orgId: "org",
      projectId: "quill-production",
      groupId: "quill",
      intent: "add-domain",
    });
    expect(surface("sidebar-project-sites-popover")).toBeNull();
  });

  it.each([
    ["has a domain of its own", place(["quill.example.com"])],
    ["is still being read", place("reading")],
  ])("Put it on your domain does not show while production %s", async (_case, production) => {
    await mount({}, inAccount({ "quill-production": production }));
    await press(surface("sidebar-project-sites"));
    expect(addDomain()).toBeNull();
  });
});
