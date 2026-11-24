import { ChevronRightIcon, SearchXIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { PageHeader } from "~/components/ui/page-header";
import { Sidebar, SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { AnchoredToastProvider, ToastProvider } from "~/components/ui/toast";
import { useTheme } from "~/hooks/useTheme";

import { FlowPage } from "./flows/FlowPage";
import { kitSearchQuery, useKitAppearance, type KitSearch, type KitView } from "./kitAppearance";
import { decodeKitArgs, encodeKitArgs, type KitArgs, type KitPlayground } from "./kitPlayground";
import type { KitSection } from "./kitSection";
import { CensusBody, CensusSummary } from "./pages/CensusPage";
import {
  ComponentPage,
  componentTabs,
  PlaygroundCanvas,
  VariantsCanvas,
  type ComponentTab,
} from "./pages/ComponentPage";
import { FoundationsPage } from "./pages/FoundationsPage";
import { OverviewPage, type KitLink } from "./pages/OverviewPage";
import { KIT_PLAYGROUNDS } from "./playgroundRegistry";
import { KIT_SECTIONS } from "./registry";
import {
  kitNavEntries,
  kitPageKey,
  resolveKitPage,
  type KitPageRef,
  type KitShellFlow,
  type NavEntry,
} from "./shell/kitPages";
import { KitNav } from "./shell/KitNav";
import {
  KIT_PANE_READY,
  KitCanvas,
  KitStage,
  isKitPaneMessage,
  type KitPaneMessage,
} from "./shell/KitStage";
import {
  CANVAS_TOOLS,
  DOCUMENT_TOOLS,
  FLOW_TOOLS,
  KitToolbar,
  type KitToolSet,
} from "./shell/KitToolbar";

const NO_FLOWS: readonly KitShellFlow[] = [];

/** The nav's width: room for a component's or a flow state's name beside its group's inset. */
const NAV_WIDTH = "17.5rem";

/** The canvas's tools and view, which survive moving between pages. */
const keepCanvas = ({ appearance, viewport, bg, zoom, outline }: KitSearch): KitSearch => ({
  ...(appearance === undefined ? {} : { appearance }),
  ...(viewport === undefined ? {} : { viewport }),
  ...(bg === undefined ? {} : { bg }),
  ...(zoom === undefined ? {} : { zoom }),
  ...(outline === undefined ? {} : { outline }),
});

const addressOf = (search: KitSearch) => {
  const query = kitSearchQuery(search);
  return `${location.pathname}${query === "" ? "" : `?${query}`}`;
};

/** Whether a click is the plain one a page opens in place on (not a new tab or window). */
const plainClick = (event: MouseEvent) =>
  !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) && event.button === 0;

const toolsOf = (ref: KitPageRef): KitToolSet =>
  ref.kind === "component" || ref.kind === "census"
    ? CANVAS_TOOLS
    : ref.kind === "flow"
      ? FLOW_TOOLS
      : DOCUMENT_TOOLS;

/** The width of an element as it resizes, for a flow that fills its room. */
function useWidth(): [(element: HTMLElement | null) => () => void, number] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((element: HTMLElement | null) => {
    if (element === null) return () => {};
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * The kit: every component the app is built from, the foundations beneath them, the looks still
 * home-made and, where the build carries the design harness, its flows. One page at a time, its
 * whole view in the address. Static fixtures only; it reads no account, project or Mate.
 */
export function KitPage({
  search,
  onSearchChange,
  sections = KIT_SECTIONS,
  flows = NO_FLOWS,
}: {
  readonly search: KitSearch;
  /** `push` for a new page, `replace` for a change of view on the same one. */
  readonly onSearchChange: (search: KitSearch, mode: "push" | "replace") => void;
  readonly sections?: readonly KitSection[];
  readonly flows?: readonly KitShellFlow[];
}) {
  const { resolvedTheme } = useTheme();
  const ref = resolveKitPage(search.page, sections, flows);
  const tools = toolsOf(ref);
  // A page that is read has one appearance; "both" is the canvas's.
  const view: KitView =
    search.appearance === "both" && !tools.both
      ? resolvedTheme
      : (search.appearance ?? resolvedTheme);
  useKitAppearance(view === "both" ? null : view);

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        {search.pane === true ? (
          <KitPane pageRef={ref} search={search} />
        ) : (
          <KitShell
            flows={flows}
            onSearchChange={onSearchChange}
            pageRef={ref}
            search={search}
            sections={sections}
            tools={tools}
            view={view}
          />
        )}
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function KitShell({
  search,
  onSearchChange,
  sections,
  flows,
  pageRef,
  tools,
  view,
}: {
  readonly search: KitSearch;
  readonly onSearchChange: (search: KitSearch, mode: "push" | "replace") => void;
  readonly sections: readonly KitSection[];
  readonly flows: readonly KitShellFlow[];
  readonly pageRef: KitPageRef;
  readonly tools: KitToolSet;
  readonly view: KitView;
}) {
  const entries = useMemo(() => kitNavEntries(sections, flows), [sections, flows]);
  const [measure, width] = useWidth();
  const ground = search.bg ?? "page";
  const zoom = search.zoom ?? 100;
  const outline = search.outline === 1;
  const oneAppearance = view === "both" ? "light" : view;

  const open = (page: string, state?: string) =>
    onSearchChange(
      {
        ...keepCanvas(search),
        ...(page === "overview" ? {} : { page }),
        ...(state === undefined ? {} : { state }),
      },
      "push",
    );
  const replace = (change: KitSearch) => onSearchChange({ ...search, ...change }, "replace");
  const linkTo = (page: string): KitLink => ({
    href: addressOf({ ...keepCanvas(search), page }),
    onClick: (event) => {
      if (!plainClick(event)) return;
      event.preventDefault();
      open(page);
    },
  });
  const hrefFor = (entry: NavEntry) =>
    addressOf({
      ...keepCanvas(search),
      ...(entry.page === "overview" ? {} : { page: entry.page }),
      ...(entry.state === undefined ? {} : { state: entry.state }),
    });

  const paneSearch = (appearance: "light" | "dark"): KitSearch => ({
    ...(search.page === undefined ? {} : { page: search.page }),
    ...(search.tab === undefined ? {} : { tab: search.tab }),
    ...(search.story === undefined ? {} : { story: search.story }),
    ...(search.bg === undefined ? {} : { bg: search.bg }),
    ...(search.zoom === undefined ? {} : { zoom: search.zoom }),
    ...(search.outline === undefined ? {} : { outline: search.outline }),
    appearance,
    pane: true,
  });
  const paneHref = (appearance: "light" | "dark") => addressOf(paneSearch(appearance));
  const paneMessage = useMemo<KitPaneMessage>(
    () => ({ type: "kit-args", args: search.args }),
    [search.args],
  );
  const stage = (label: string) => (content: ReactNode) => (
    <KitStage
      ground={ground}
      label={label}
      outline={outline}
      paneHref={paneHref}
      paneMessage={paneMessage}
      view={view}
      viewport={search.viewport}
      zoom={zoom}
    >
      {content}
    </KitStage>
  );

  const flowState =
    pageRef.kind === "flow"
      ? pageRef.flow.states?.find((candidate) => candidate.id === search.state)
      : undefined;
  const aloneHref =
    pageRef.kind === "component" || pageRef.kind === "census"
      ? addressOf({
          ...paneSearch(oneAppearance),
          ...(search.args === undefined ? {} : { args: search.args }),
          ...(search.viewport === undefined ? {} : { viewport: search.viewport }),
        })
      : pageRef.kind === "flow"
        ? (() => {
            const query = new URLSearchParams(flowState?.search ?? "");
            query.set("theme", oneAppearance);
            return `${pageRef.flow.href}?${query}`;
          })()
        : undefined;

  return (
    <SidebarProvider
      className="h-svh min-h-0"
      style={{ "--sidebar-width": NAV_WIDTH } as CSSProperties}
    >
      <Sidebar collapsible="none">
        <KitNav
          entries={entries}
          hrefFor={hrefFor}
          onOpen={(entry) => open(entry.page, entry.state)}
          page={search.page}
          state={search.state}
        />
      </Sidebar>
      <SidebarInset className="min-h-0">
        <KitToolbar
          aloneHref={aloneHref}
          ground={ground}
          onChange={(change) => {
            const { viewport: _viewport, outline: _outline, ...kept } = search;
            const viewport = "viewport" in change ? change.viewport : search.viewport;
            const outlined = change.outline ?? search.outline === 1;
            onSearchChange(
              {
                ...kept,
                ...(change.appearance === undefined ? {} : { appearance: change.appearance }),
                ...(change.bg === undefined ? {} : { bg: change.bg }),
                ...(change.zoom === undefined ? {} : { zoom: change.zoom }),
                ...(viewport === undefined ? {} : { viewport }),
                ...(outlined ? { outline: 1 } : {}),
              },
              "replace",
            );
          }}
          outline={outline}
          tools={tools}
          trail={<Trail pageRef={pageRef} stateLabel={flowState?.label} />}
          view={view}
          viewport={search.viewport}
          zoom={zoom}
        />
        <div className="flex min-h-0 flex-1 flex-col" key={kitPageKey(pageRef)} ref={measure}>
          <KitPageView
            flowState={search.state}
            linkTo={linkTo}
            onArgsChange={(args, playgroundInitial) => {
              const encoded = encodeKitArgs(args, playgroundInitial);
              const { args: _previous, ...rest } = search;
              onSearchChange(encoded === undefined ? rest : { ...rest, args: encoded }, "replace");
            }}
            onFlowStateChange={(state) => {
              const { state: _previous, ...rest } = search;
              onSearchChange(state === undefined ? rest : { ...rest, state }, "push");
            }}
            onStoryChange={(story) => {
              const { story: _story, args: _args, ...rest } = search;
              onSearchChange({ ...rest, story }, "replace");
            }}
            onTabChange={(tab) => {
              const { tab: _previous, ...rest } = search;
              replace({ ...rest, tab });
            }}
            pageRef={pageRef}
            flows={flows}
            search={search}
            sections={sections}
            stage={stage}
            view={view}
            width={width}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function Trail({
  pageRef,
  stateLabel,
}: {
  readonly pageRef: KitPageRef;
  readonly stateLabel: string | undefined;
}) {
  const parts: string[] =
    pageRef.kind === "overview"
      ? ["Overview"]
      : pageRef.kind === "foundation"
        ? ["Foundations", pageRef.foundation.title]
        : pageRef.kind === "component"
          ? ["Components", pageRef.section.title]
          : pageRef.kind === "flow"
            ? ["Flows", pageRef.flow.title, ...(stateLabel === undefined ? [] : [stateLabel])]
            : pageRef.kind === "census"
              ? ["Census"]
              : ["Not found"];
  return (
    <>
      {parts.map((part, index) => (
        <span className="flex min-w-0 items-center gap-1.5" key={part}>
          {index === 0 ? null : (
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          )}
          <span
            className={
              index === parts.length - 1
                ? "truncate font-medium text-foreground"
                : "shrink-0 text-muted-foreground"
            }
          >
            {part}
          </span>
        </span>
      ))}
    </>
  );
}

/** The playground a component page plays: the one asked for by name, else its first. */
function storyOf(
  playgrounds: readonly KitPlayground[],
  asked: string | undefined,
): KitPlayground | undefined {
  return playgrounds.find(({ name }) => name === asked) ?? playgrounds[0];
}

/** The tab a component page shows: the one asked for when it has it, else its first. */
function tabOf(tabs: readonly ComponentTab[], asked: string | undefined): ComponentTab {
  return tabs.find((tab) => tab === asked) ?? tabs[0] ?? "variants";
}

function KitPageView({
  pageRef,
  search,
  sections,
  flows,
  view,
  width,
  stage,
  linkTo,
  onTabChange,
  onArgsChange,
  onStoryChange,
  flowState,
  onFlowStateChange,
}: {
  readonly pageRef: KitPageRef;
  readonly search: KitSearch;
  readonly sections: readonly KitSection[];
  readonly flows: readonly KitShellFlow[];
  readonly view: KitView;
  readonly width: number;
  readonly stage: (label: string) => (content: ReactNode) => ReactNode;
  readonly linkTo: (page: string) => KitLink;
  readonly onTabChange: (tab: ComponentTab) => void;
  readonly onArgsChange: (args: KitArgs, initial: KitArgs) => void;
  readonly onStoryChange: (story: string) => void;
  readonly flowState: string | undefined;
  readonly onFlowStateChange: (state: string | undefined) => void;
}) {
  switch (pageRef.kind) {
    case "overview":
      return <OverviewPage flows={flows} linkTo={linkTo} sections={sections} />;
    case "foundation":
      return <FoundationsPage foundation={pageRef.foundation.id} />;
    case "component": {
      const playgrounds = KIT_PLAYGROUNDS.get(pageRef.section.id) ?? [];
      const playground = storyOf(playgrounds, search.story);
      const tabs = componentTabs(playground);
      return (
        <ComponentPage
          args={decodeKitArgs(search.args)}
          onArgsChange={(args) => onArgsChange(args, playground?.initial ?? {})}
          onStoryChange={onStoryChange}
          onTabChange={onTabChange}
          playground={playground}
          playgrounds={playgrounds}
          section={pageRef.section}
          stage={stage(pageRef.section.title)}
          tab={tabOf(tabs, search.tab)}
        />
      );
    }
    case "flow":
      return (
        <FlowPage
          appearance={view}
          flow={pageRef.flow}
          onStateChange={onFlowStateChange}
          state={flowState}
          viewport={search.viewport ?? Math.max(width - 32, 320)}
          zoom={search.zoom ?? 100}
        />
      );
    case "census":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b px-8 py-6">
            <PageHeader line={<CensusSummary sections={sections} />} title="Census" />
          </div>
          {stage("Census")(<CensusBody at={pageRef.at} sections={sections} />)}
        </div>
      );
    case "missing":
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            action={
              <Button {...linkProps(linkTo("overview"))} variant="secondary">
                Open the overview
              </Button>
            }
            mark={<SearchXIcon />}
            size="page"
          >
            The kit has no page called “{pageRef.page}”.
          </EmptyState>
        </div>
      );
  }
}

const linkProps = (link: KitLink) => ({
  render: <a href={link.href} onClick={link.onClick} />,
});

/**
 * The canvas alone, for a frame of the "both" view or "Open alone": no navigation or bar, its
 * playground's arguments from the address and then from its page's messages.
 */
function KitPane({
  pageRef,
  search,
}: {
  readonly pageRef: KitPageRef;
  readonly search: KitSearch;
}) {
  const [encoded, setEncoded] = useState(search.args);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || !isKitPaneMessage(event.data)) return;
      setEncoded(event.data.args);
    };
    window.addEventListener("message", onMessage);
    if (window.parent !== window) window.parent.postMessage(KIT_PANE_READY, location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const args = decodeKitArgs(encoded);
  const content = (() => {
    switch (pageRef.kind) {
      case "component": {
        const playground = storyOf(KIT_PLAYGROUNDS.get(pageRef.section.id) ?? [], search.story);
        const tab = tabOf(componentTabs(playground), search.tab);
        return tab === "playground" && playground !== undefined ? (
          <PlaygroundCanvas args={args} playground={playground} section={pageRef.section} />
        ) : (
          <VariantsCanvas section={pageRef.section} />
        );
      }
      case "census":
        return <CensusBody at={pageRef.at} sections={KIT_SECTIONS} />;
      default:
        return null;
    }
  })();
  return (
    <KitCanvas
      ground={search.bg ?? "page"}
      outline={search.outline === 1}
      viewport={search.viewport}
      zoom={search.zoom ?? 100}
    >
      {content}
    </KitCanvas>
  );
}
