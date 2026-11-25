import { useAtomValue } from "@effect/atom-react";
import { ProductionRemoval } from "./GitStopDetail";
import { runningShort } from "@t3tools/client-runtime/zerops/activity/runningNow";
import { useProjectRoleOffers } from "~/zerops/usePlatformCapabilities";
import { GitDeliveryStatus } from "./GitDeliveryStatus";
import { RunningClock } from "./system";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
/**
 * A project's places on its row (the menu by project): one popover of every address the app knows
 * for the project — production's, each stage's, every Mate's — with two doors to it. The globe sits
 * in the row's hover slot; the environment tag sits among the row's tags, only while a place is
 * not calm, and opens the popover at the section it speaks of.
 *
 * A place's section is what its chip's menu said (`ChipMenu`): its state, what went wrong, the fix
 * for the viewer's own Mate, its public access, its links and its way to Zerops. A Mate's section
 * is one row per service by its real hostname (`mateParts`), as a place's addresses are — each
 * part's dev, then its stage; a pool's dev is each workspace zcp holds on it, by its alias, read
 * from a conversation of the Mate (`useMatesLeases`) — then its other addresses. A place with nothing
 * deployed is its head alone. Each address is listed once, opens in a
 * new tab, and copies from its row or its link (`c`, ⌘C, or the button an address row's hover
 * shows).
 *
 * What it says is `SidebarProjectSites.logic.ts`'s; this draws it.
 */
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/gui";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { isMacPlatform } from "~/lib/utils";
import { useAddressesSheet } from "~/zerops/addressesSheet";
import type { FixProblem } from "~/zerops/fixRequest";
import { usePublicAccess } from "~/zerops/usePublicAccess";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import { useRunningNow } from "~/zerops/activity/useRunningNow";
import { useLacksOwnDomain } from "~/zerops/ownDomain";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { useMatesLeases, type MatesLeases } from "~/zerops/useMatesLeases";
import { usePutLiveStanding } from "~/zerops/putLive";
import { applicationOperationAtom } from "~/zerops/useEnvironmentOperation";

import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Row } from "../ui/row";
import { SectionHeader } from "../ui/section";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ZeropsMark } from "../ZeropsMark";
import { MateFace } from "./primitives";
import { useHeadingLine } from "./SidebarHeadingLine";
import type { HeadingLineInput } from "./SidebarHeadingLine.logic";
import { ownerMark } from "./SidebarMateRow.logic";
import { AskToFix, EnvDot, OpenInZerops, type ChipMate } from "./SidebarProductionChip";
import type { ChipMenuModel, ChipMenuStop, ProductionChip } from "./SidebarProductionChip.logic";
import {
  answeringSections,
  filterSites,
  productionUrl,
  projectSitesSections,
  applicationSetupOf,
  projectSitesStatus,
  readsLeases,
  sitesHoldNothing,
  sitesLinkCount,
  type SitesLink,
  type SitesMateFacts,
  type SitesService,
  type SitesStatus,
} from "./SidebarProjectSites.logic";
import { StopPublicAccessStatus } from "./StopPublicAccess";
import { StopReadAgain } from "./StopReadAgain";

/** One of the project's Mates, as its section and the fix list it. */
export interface SitesMate extends ChipMate {
  /** The listing's row (`ZeropsCandidatePresentation`): its routes and services where read. */
  readonly candidate: ChipMate["candidate"] & {
    readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
    readonly services?: {
      readonly hostnames: ReadonlyArray<string>;
      /** Its dev pools (`ZeropsEnvironmentServices.pools`), whose routes are their leases'. */
      readonly pools?: ReadonlyArray<string>;
    };
  };
  readonly name: string;
  /** Whose it is, where it is a colleague's (ZeropsMateOwner): "Vira · Theo's". */
  readonly owner: ZeropsMateOwner | undefined;
}

export interface ProjectSitesInput {
  readonly groupId: string;
  readonly projectName: string;
  /** Production's menu model as of the moment the popover opens (`productionMenu`); undefined where the project has none. */
  readonly production: ((nowMs: number) => ChipMenuModel) | undefined;
  /** The stages' menu model (`stageMenu`), each stage and each being created; undefined where none. */
  readonly stages: ((nowMs: number) => ChipMenuModel) | undefined;
  /** Every Mate of the project, in the menu's kid order (yours first, then colleagues', each by creation). */
  readonly mates: ReadonlyArray<SitesMate>;
  /** Production's and the stages' chips as drawn (`drawnChip`), for the environment tag. */
  readonly prodChip: ProductionChip | undefined;
  readonly stageChip: ProductionChip | undefined;
  /** The heading line's input (`HeadingLineInput`): what comes up, lands, deploys. */
  readonly line: HeadingLineInput | undefined;
  readonly onAskToFix: ((mateProjectId: string, problem: FixProblem) => void) | undefined;
  /** A stop's own page, where one opens. */
  readonly onOpenStop: (projectId: string) => (() => void) | undefined;
  /** The project's own page; absent, no door to it is drawn. */
  readonly onOpenPage?: (() => void) | undefined;
}

/** More addresses than this, and a filter sits under the popover's title. */
const FILTER_FROM = 9;
/** How long a copied address says so. */
const COPIED_MS = 1_200;
/** How long the section the tag spoke of stays lit. */
const FLASH_MS = 1_200;

/** A Mate as its section is read, with zcp's leases and pool pairs where a conversation of it read them. */
const factsOf = (mate: SitesMate, leases: MatesLeases = {}): SitesMateFacts => ({
  projectId: mate.candidate.project.id,
  name: mate.name,
  owner: mate.owner === undefined || mate.owner.isViewer ? undefined : mate.owner.called,
  routes: mate.candidate.routes,
  hostnames: mate.candidate.services?.hostnames,
  controlPlane: mate.candidate.service?.name,
  pools: mate.candidate.services?.pools,
  leases: leases[mate.candidate.project.id]?.leases,
  poolPairs: leases[mate.candidate.project.id]?.poolPairs,
  standIns: leases[mate.candidate.project.id]?.standIns,
});

/** The section a key names, else — for a stage named differently — the first stage's. */
function sectionIn(root: HTMLElement, key: string): HTMLElement | null {
  const sections = [...root.querySelectorAll<HTMLElement>("[data-sites-section]")];
  return (
    sections.find((section) => section.dataset["sitesSection"] === key) ??
    (key.startsWith("stage:")
      ? (sections.find((section) => section.dataset["sitesPlace"] === "stage") ?? null)
      : null)
  );
}

const sameStatus = (left: SitesStatus | undefined, right: SitesStatus | undefined) =>
  left?.tone === right?.tone &&
  left?.word === right?.word &&
  left?.sentence === right?.sentence &&
  left?.section === right?.section;

/** One popover, two doors: the row places `tag` among its tags and `globe` in its hover slot. */
export function ProjectSites(
  props: ProjectSitesInput & {
    readonly children: (parts: { readonly tag: ReactNode; readonly globe: ReactNode }) => ReactNode;
  },
): ReactNode {
  const { projectName, production, stages, mates, line, children } = props;
  const { landing } = useHeadingLine(line);
  const status = projectSitesStatus({
    prodChip: props.prodChip,
    stageChip: props.stageChip,
    line,
    landing,
    runUnderWay: usePutLiveStanding(props.groupId).kind === "going",
    setup: applicationSetupOf(useAtomValue(applicationOperationAtom(props.groupId))),
  });
  const [open, setOpen] = useState(false);
  const [door, setDoor] = useState<"globe" | "tag">("globe");
  const [query, setQuery] = useState("");
  // The tag stays while the popover it opened is open, so the popover never loses its anchor.
  const [held, setHeld] = useState(status);
  if (status !== undefined && !sameStatus(status, held)) setHeld(status);
  const shown = status ?? (open && door === "tag" ? held : undefined);
  const id = useId();
  const globeId = `${id}-globe`;
  const tagId = `${id}-tag`;
  const popup = useRef<HTMLDivElement>(null);

  // What the doors say needs no moment: addresses do not age. At rest no Mate's leases are read,
  // so a dev pool's previews are only possible: they keep the globe from saying none.
  const restingMates = mates.map((mate) => factsOf(mate));
  const atRest = projectSitesSections({
    production: production?.(0),
    productionUnread: false,
    stages: stages?.(0),
    unreadStages: [],
    placeRoutes: (stop) => stop.routes,
    mates: restingMates,
  });
  const reading = atRest.some((section) => section.links === undefined);
  const none = !reading && sitesHoldNothing(atRest, restingMates);
  const prodUrl = productionUrl(production?.(0));
  const mac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  const globeTip = none
    ? "No addresses yet"
    : prodUrl === undefined
      ? "Addresses"
      : `Addresses · ${mac ? "⌘" : "Ctrl"}-click opens production`;
  const openProduction = () => {
    if (prodUrl !== undefined) window.open(prodUrl, "_blank", "noopener,noreferrer");
  };

  const close = () => {
    setOpen(false);
  };
  const globe = (
    <Tooltip>
      <TooltipTrigger
        render={
          <PopoverTrigger
            id={globeId}
            onAuxClick={(event) => {
              if (event.button !== 1 || prodUrl === undefined) return;
              event.preventDefault();
              openProduction();
            }}
            onClick={(event) => {
              if (!(event.metaKey || event.ctrlKey) || prodUrl === undefined) return;
              event.preventBaseUIHandler();
              openProduction();
            }}
            render={
              <Button
                aria-label={`Addresses of ${projectName}`}
                // A finger never hovers: the row's ··· holds its addresses ("Addresses").
                className="group/globe pointer-coarse:hidden"
                data-empty={none ? "" : undefined}
                data-zerops-surface="sidebar-project-sites"
                size="icon-sm"
                variant="sidebar"
              />
            }
          />
        }
      >
        {/* Dimmed, still pressable, where nothing anywhere has an address yet. */}
        <GlobeIcon
          aria-hidden="true"
          className={
            none
              ? "size-3.5 opacity-45 transition-opacity group-hover/globe:opacity-100 group-data-popup-open/globe:opacity-100"
              : "size-3.5"
          }
        />
      </TooltipTrigger>
      {open ? null : <TooltipPopup side="bottom">{globeTip}</TooltipPopup>}
    </Tooltip>
  );
  const tag =
    shown === undefined ? null : (
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              id={tagId}
              render={
                <Button
                  aria-label={shown.sentence}
                  className="flex shrink-0"
                  data-zerops-surface="sidebar-project-env-tag"
                  variant="bare"
                />
              }
            />
          }
        >
          <span className="zerops-sites-tag" data-tone={shown.tone}>
            <EnvDot dot={shown.dot} label={shown.word} />
            {/* In a narrow menu the dot alone stands for it; the tooltip and its name say the rest. */}
            <span className="menu-tag-word">{shown.word}</span>
          </span>
        </TooltipTrigger>
        {open ? null : <TooltipPopup side="bottom">{shown.sentence}</TooltipPopup>}
      </Tooltip>
    );
  const focusSection = door === "tag" ? shown?.section : undefined;

  return (
    <Popover
      onOpenChange={(next, details) => {
        // Esc clears the filter first, then closes.
        if (!next && details.reason === "escape-key" && query !== "") {
          details.cancel();
          setQuery("");
          return;
        }
        if (next) {
          setDoor(details.trigger?.id === tagId ? "tag" : "globe");
          setQuery("");
        }
        setOpen(next);
      }}
      open={open}
      triggerId={door === "tag" && shown !== undefined ? tagId : globeId}
    >
      {children({
        tag,
        // The project's own page sits beside its addresses, as a link: a row's press may open a
        // Mate or fold its group, so the page needs a door of its own (the owner, 2026-10-14).
        globe: (
          <>
            {props.onOpenPage === undefined ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={`${projectName}'s page`}
                      // A finger never hovers: the row's ··· holds it ("Open project").
                      className="pointer-coarse:hidden"
                      data-zerops-surface="sidebar-project-page"
                      onClick={props.onOpenPage}
                      size="icon-sm"
                      variant="sidebar"
                    />
                  }
                >
                  <LayoutDashboardIcon aria-hidden="true" className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="bottom">Project page</TooltipPopup>
              </Tooltip>
            )}
            {globe}
          </>
        ),
      })}
      <PopoverPopup
        align="end"
        // Kept at the door's end and slid to fit, never flipped to its start, and never out to the
        // side over the conversation: where neither below nor above holds it whole, it takes the
        // roomier one and its list scrolls in what it has (`--available-height`).
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        collisionPadding={8}
        padding="none"
        side="bottom"
        sideOffset={6}
        width="lg"
        aria-label={`Addresses of ${projectName}`}
        data-zerops-surface="sidebar-project-sites-popover"
        initialFocus={(openType) => {
          const root = popup.current;
          if (root === null) return true;
          // A press opens it calm, nothing lit as if picked; its keys still land in it.
          if (openType !== "keyboard") return root;
          const section = focusSection === undefined ? null : sectionIn(root, focusSection);
          return (
            section?.querySelector<HTMLElement>("[data-sites-nav]") ??
            root.querySelector<HTMLElement>("[data-sites-filter]") ??
            root.querySelector<HTMLElement>("[data-sites-nav]") ??
            root
          );
        }}
        ref={popup}
      >
        <SitesPanel
          focusSection={focusSection}
          groupId={props.groupId}
          line={line}
          mates={mates}
          onAskToFix={
            props.onAskToFix === undefined
              ? undefined
              : (mateProjectId, problem) => {
                  close();
                  props.onAskToFix?.(mateProjectId, problem);
                }
          }
          onOpenStop={(projectId) => {
            const opens = props.onOpenStop(projectId);
            return opens === undefined
              ? undefined
              : () => {
                  close();
                  opens();
                };
          }}
          onClose={close}
          onQuery={setQuery}
          production={production}
          projectName={projectName}
          query={query}
          stages={stages}
        />
      </PopoverPopup>
    </Popover>
  );
}

/**
 * The popover's content, drawn only while it is open — so its first draw is the moment it opened:
 * the title, the filter where there are many addresses, then the sections in their own scroll.
 */
export function SitesPanel({
  production,
  stages,
  mates,
  line,
  projectName,
  groupId,
  query,
  onQuery,
  focusSection,
  answering = false,
  onAskToFix,
  onOpenStop,
  onClose,
}: {
  readonly production: ProjectSitesInput["production"];
  readonly stages: ProjectSitesInput["stages"];
  readonly mates: ReadonlyArray<SitesMate>;
  readonly line: HeadingLineInput | undefined;
  readonly projectName: string;
  readonly groupId: string;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  /** The section the tag spoke of: scrolled into view and lit as the popover opens. */
  readonly focusSection: string | undefined;
  /** Only where the project answers (`answeringSections`): the project's own list. */
  readonly answering?: boolean | undefined;
  readonly onAskToFix: ProjectSitesInput["onAskToFix"];
  readonly onOpenStop: ProjectSitesInput["onOpenStop"];
  /** Closes the popover, as a door to elsewhere opens. */
  readonly onClose: () => void;
}) {
  const [openedAt] = useState(Date.now);
  // A place's addresses sheet, opened from its head (or to add a domain) as the popover closes.
  const orgId = useAccountOrgId();
  const manage: ManageDoor | undefined =
    orgId === null
      ? undefined
      : (projectId, intent) => {
          onClose();
          useAddressesSheet
            .getState()
            .open({ orgId, projectId, groupId, ...(intent === undefined ? {} : { intent }) });
        };
  const prod = production?.(openedAt);
  const stg = stages?.(openedAt);
  // Each place's public access as read, over what its listing holds (`PlaceAccess`).
  const [bound, setBound] = useState<ReadonlyMap<string, ReadonlyArray<ZeropsPublicRoute>>>(
    () => new Map(),
  );
  // Each Mate's dev pools list their parts' previews, as a conversation of the Mate read zcp's leases.
  const leases = useMatesLeases(
    mates
      .filter((mate) => readsLeases(factsOf(mate)))
      .map((mate) => ({ projectId: mate.candidate.project.id, threadKey: mate.threadKey })),
  );
  const every = projectSitesSections({
    production: prod,
    productionUnread: prod === undefined && line?.production !== undefined,
    stages: stg,
    unreadStages: stg === undefined ? (line?.stages.map((stage) => stage.name) ?? []) : [],
    placeRoutes: (stop) =>
      (stop.projectId === undefined ? undefined : bound.get(stop.projectId)) ?? stop.routes,
    mates: mates.map((mate) => factsOf(mate, leases)),
  });
  const sections = answering ? answeringSections(every) : every;
  const filtering = query.trim() !== "";
  const kept = new Map(filterSites(sections, query).map((section) => [section.key, section]));
  const total = sitesLinkCount(sections);
  const faces = new Map(mates.map((mate) => [mate.candidate.project.id, mate]));

  const scroll = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    const root = scroll.current;
    if (root === null || focusSection === undefined) return;
    const section = sectionIn(root, focusSection);
    if (section === null) return;
    root.scrollTop = section.offsetTop;
    setFlash(section.dataset["sitesSection"]);
  }, [focusSection]);
  useEffect(() => {
    if (flash === undefined) return;
    const timer = setTimeout(() => {
      setFlash(undefined);
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [flash]);

  // More below the fold fades out at the bottom edge, so the list never reads as cut off: read
  // after each draw, as it scrolls and as it resizes.
  useLayoutEffect(() => {
    if (scroll.current !== null) markMoreBelow(scroll.current);
  });
  useEffect(() => {
    const root = scroll.current;
    if (root === null) return;
    const mark = () => {
      markMoreBelow(root);
    };
    root.addEventListener("scroll", mark, { passive: true });
    const sized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(mark);
    sized?.observe(root);
    return () => {
      root.removeEventListener("scroll", mark);
      sized?.disconnect();
    };
  }, []);

  const [copied, setCopied] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (copied === undefined) return;
    const timer = setTimeout(() => {
      setCopied(undefined);
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  const copy = (link: CopiedLink) => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined) return;
    clipboard.writeText(link.url).then(
      () => {
        setCopied(link.key);
      },
      () => {},
    );
  };

  const filter = useRef<HTMLInputElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = event.currentTarget;
    const typing = event.target instanceof HTMLInputElement;
    if (event.key === "/" && !typing && filter.current !== null) {
      event.preventDefault();
      filter.current.focus();
      return;
    }
    const moves = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!moves.includes(event.key) || (typing && (event.key === "Home" || event.key === "End")))
      return;
    const items = [...root.querySelectorAll<HTMLElement>("[data-sites-nav]")].filter(
      (item) => item.closest("[hidden]") === null,
    );
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const last = items.length - 1;
    const next =
      event.key === "Home"
        ? items[0]
        : event.key === "End"
          ? items[last]
          : event.key === "ArrowDown"
            ? items[at < 0 ? 0 : Math.min(at + 1, last)]
            : at <= 0
              ? (filter.current ?? items[0])
              : items[at - 1];
    event.preventDefault();
    next?.focus();
    next?.scrollIntoView?.({ block: "nearest" });
  };

  const first = mates[0];
  return (
    <div className="zerops-sites-body" onKeyDown={onKeyDown}>
      <div className="flex-none px-4 pt-3 pb-2">
        <SectionHeader
          count={total === 0 ? undefined : total === 1 ? "1 address" : `${String(total)} addresses`}
          level={3}
          title={projectName}
        />
      </div>
      {total < FILTER_FROM ? null : (
        <div className="mx-2 mb-1.5 flex-none">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Filter addresses"
              data-sites-filter=""
              nativeInput
              onChange={(event) => {
                onQuery(event.target.value);
              }}
              placeholder="Filter addresses"
              ref={filter}
              size="sm"
              spellCheck={false}
              type="text"
              value={query}
            />
          </InputGroup>
        </div>
      )}
      <div className="zerops-sites-scroll" ref={scroll}>
        {sections.length === 0 ? (
          <div className="flex flex-col gap-1" data-zerops-surface="sidebar-project-sites-empty">
            <EmptyState mark={<GlobeIcon aria-hidden="true" />} size="row">
              No public addresses yet
            </EmptyState>
            {first === undefined ? null : <OpenInZerops projectId={first.candidate.project.id} />}
          </div>
        ) : filtering && kept.size === 0 ? (
          <div data-zerops-surface="sidebar-project-sites-nomatch">
            <EmptyState mark={<SearchIcon aria-hidden="true" />} size="row">
              {`No address matches “${query.trim()}”`}
            </EmptyState>
          </div>
        ) : null}
        {sections.map((section) => {
          const shown = kept.get(section.key);
          const links = filtering ? shown?.links : section.links;
          const body = (
            <SitesLinks
              copied={copied}
              links={links}
              onCopy={copy}
              sayNone={section.kind === "place" && section.stop !== undefined}
            />
          );
          return (
            <section
              aria-label={section.title}
              className="zerops-sites-section"
              data-flash={flash === section.key ? "" : undefined}
              data-sites-place={section.kind === "place" ? section.place : undefined}
              data-sites-section={section.key}
              hidden={filtering && shown === undefined}
              key={section.key}
            >
              {section.kind === "place" ? (
                <PlaceSection
                  filtering={filtering}
                  groupId={groupId}
                  manage={manage}
                  place={section.place}
                  quiet={section.quiet}
                  mates={mates}
                  onAskToFix={onAskToFix}
                  onOpenStop={onOpenStop}
                  onRoutes={(projectId, routes) => {
                    setBound((before) => withRoutes(before, projectId, routes));
                  }}
                  stop={section.stop}
                  title={section.title}
                >
                  {body}
                </PlaceSection>
              ) : (
                <>
                  <MateHead
                    mate={faces.get(section.projectId)}
                    owner={section.owner}
                    projectId={section.projectId}
                    title={section.title}
                  />
                  <SitesServices
                    copied={copied}
                    onCopy={copy}
                    services={
                      filtering ? (shown?.kind === "mate" ? shown.services : []) : section.services
                    }
                  />
                  {body}
                  {filtering || manage === undefined ? null : (
                    <ManageRow manage={manage} name={section.title} projectId={section.projectId} />
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
      <span aria-live="polite" className="sr-only">
        {copied === undefined ? "" : "Copied"}
      </span>
    </div>
  );
}

/** Marks a scroll container that holds more below its fold (`data-more-below`). */
function markMoreBelow(root: HTMLElement) {
  const below = root.scrollTop + root.clientHeight < root.scrollHeight - 1;
  if (below !== root.hasAttribute("data-more-below"))
    root.toggleAttribute("data-more-below", below);
}

/** The bound routes with one place's as read, the same map where nothing changed. */
function withRoutes(
  before: ReadonlyMap<string, ReadonlyArray<ZeropsPublicRoute>>,
  projectId: string,
  routes: ReadonlyArray<ZeropsPublicRoute> | undefined,
): ReadonlyMap<string, ReadonlyArray<ZeropsPublicRoute>> {
  const was = before.get(projectId);
  const same =
    was === undefined || routes === undefined
      ? was === routes
      : was.length === routes.length &&
        was.every((route, index) => route.url === routes[index]?.url);
  if (same) return before;
  const after = new Map(before);
  if (routes === undefined) after.delete(projectId);
  else after.set(projectId, routes);
  return after;
}

/** Opens the addresses sheet for a place's project, to add a domain where `intent` says so. */
type ManageDoor = (projectId: string, intent?: "add-domain") => void;

/**
 * A place's section: its head, what went wrong and the fix, its public access, its links — and
 * production's offer of a domain of its own while it has none.
 */
function PlaceSection({
  stop,
  title,
  place,
  quiet,
  manage,
  groupId,
  mates,
  filtering,
  onAskToFix,
  onOpenStop,
  onRoutes,
  children,
}: {
  readonly stop: ChipMenuStop | undefined;
  readonly title: string;
  readonly place: "production" | "stage";
  /** Nothing deployed there: its head alone, title and state word. */
  readonly quiet: boolean;
  /** `undefined` outside an account, where no sheet reads a place. */
  readonly manage: ManageDoor | undefined;
  readonly groupId: string;
  readonly mates: ReadonlyArray<ChipMate>;
  readonly filtering: boolean;
  readonly onAskToFix: ProjectSitesInput["onAskToFix"];
  readonly onOpenStop: ProjectSitesInput["onOpenStop"];
  readonly onRoutes: (
    projectId: string,
    routes: ReadonlyArray<ZeropsPublicRoute> | undefined,
  ) => void;
  readonly children: ReactNode;
}) {
  const projectId = stop?.git === undefined ? stop?.projectId : undefined;
  const detailId = stop?.environmentId ?? projectId;
  const opens = detailId === undefined ? undefined : onOpenStop(detailId);
  // The furthest of what its platform runs now, after its word: ` · shop building 2m`. The row
  // stays one line, so what it runs gives its room to what is happening to it.
  const [running] = useRunningNow(projectId);
  const head = {
    lead: <EnvDot dot={stop?.dot ?? "off"} label={stop?.word ?? "Reading…"} />,
    title: (
      <>
        {title}
        {stop?.version === undefined || running !== undefined ? null : (
          <span className="zerops-envpop-version">{stop.version}</span>
        )}
      </>
    ),
    // What it says, under its name: its word, what it runs now, and that run's clock.
    line:
      stop?.git !== undefined && running === undefined ? undefined : (
        <span className="zerops-envpop-word" data-tone={stop?.tone ?? "muted"}>
          {stop?.git === undefined ? (stop?.word ?? "Reading…") : null}
          {running === undefined ? null : (
            <span data-zerops-surface="sidebar-project-sites-running">
              {stop?.git === undefined ? " · " : null}
              {runningShort(running)}
            </span>
          )}
          {running === undefined || running.waiting ? null : (
            <>
              {" "}
              <RunningClock short since={running.since} />
            </>
          )}
        </span>
      ),
  };
  return (
    <>
      <div className="zerops-sites-sectionhead">
        {opens === undefined ? (
          <Row
            {...head}
            className="flex-1"
            data-zerops-surface="sidebar-project-sites-place"
            size="xs"
          />
        ) : (
          <Row
            {...head}
            className="flex-1"
            data-sites-nav=""
            data-zerops-surface="sidebar-project-sites-place"
            onClick={opens}
            pressable
            render={<button type="button" />}
            size="xs"
          />
        )}
        {projectId === undefined ? null : <ZeropsDoor name={title} projectId={projectId} />}
      </div>
      {quiet ? null : (
        <PlaceBody
          filtering={filtering}
          groupId={groupId}
          manage={manage}
          mates={mates}
          onAskToFix={onAskToFix}
          onRoutes={onRoutes}
          place={place}
          projectId={projectId}
          stop={stop}
          title={title}
        >
          {children}
        </PlaceBody>
      )}
    </>
  );
}

/**
 * What a place with something deployed says under its head: what went wrong and the fix, its
 * public access, its links — and production's offer of a domain of its own while it has none.
 */
function PlaceBody({
  stop,
  title,
  place,
  projectId,
  manage,
  groupId,
  mates,
  filtering,
  onAskToFix,
  onRoutes,
  children,
}: {
  readonly stop: ChipMenuStop | undefined;
  readonly title: string;
  readonly place: "production" | "stage";
  readonly projectId: string | undefined;
  readonly manage: ManageDoor | undefined;
  readonly groupId: string;
  readonly mates: ReadonlyArray<ChipMate>;
  readonly filtering: boolean;
  readonly onAskToFix: ProjectSitesInput["onAskToFix"];
  readonly onRoutes: (
    projectId: string,
    routes: ReadonlyArray<ZeropsPublicRoute> | undefined,
  ) => void;
  readonly children: ReactNode;
}) {
  return (
    <>
      {filtering || projectId === undefined ? null : <StopReadAgain projectId={projectId} />}
      {filtering || stop?.note === undefined ? null : (
        <p className="zerops-sites-note" data-zerops-surface="sidebar-project-sites-note">
          {stop.note}
        </p>
      )}
      {filtering || stop?.fix === undefined || onAskToFix === undefined ? null : (
        <AskToFix
          groupId={groupId}
          mates={mates}
          onAsk={onAskToFix}
          problem={stop.fix}
          projectId={projectId}
        />
      )}
      {stop?.git?.environment === undefined ? null : (
        <GitPlaceEvidence appId={groupId} git={stop.git} />
      )}
      {place !== "production" || stop?.environmentId === undefined ? null : (
        <ProductionRemoval appId={groupId} environmentId={stop.environmentId} />
      )}
      {projectId === undefined ? null : (
        <PlaceAccess filtering={filtering} onRoutes={onRoutes} projectId={projectId} />
      )}
      {stop?.git === undefined ? children : null}
      {filtering ||
      place !== "production" ||
      projectId === undefined ||
      manage === undefined ? null : (
        <AddYourDomain manage={manage} projectId={projectId} />
      )}
      {filtering || projectId === undefined || manage === undefined ? null : (
        <ManageRow manage={manage} name={title} projectId={projectId} />
      )}
    </>
  );
}

/**
 * A place's addresses sheet, under its addresses: a row like them that says what it opens, its
 * words on the names' edge and its mark in the place mark's column.
 */
function ManageRow({
  manage,
  projectId,
  name,
}: {
  readonly manage: ManageDoor;
  readonly projectId: string;
  readonly name: string;
}) {
  if (!useProjectRoleOffers(projectId).manageAddresses) return null;
  return (
    <Row
      aria-label={`Manage the addresses of ${name}`}
      data-sites-nav=""
      data-zerops-surface="sidebar-project-sites-manage"
      lead={<SlidersHorizontalIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />}
      onClick={() => {
        manage(projectId);
      }}
      pressable
      render={<button type="button" />}
      size="xs"
      title="Manage addresses"
    />
  );
}

/** Production's offer of a domain of its own, only once it is read and has none. */
function AddYourDomain({
  manage,
  projectId,
}: {
  readonly manage: ManageDoor;
  readonly projectId: string;
}) {
  const lacks = useLacksOwnDomain(projectId);
  if (!useProjectRoleOffers(projectId).manageAddresses || !lacks) return null;
  return (
    <Row
      data-sites-nav=""
      data-zerops-surface="sidebar-project-sites-add-domain"
      lead={<PlusIcon aria-hidden="true" className="size-3.5 text-primary" />}
      onClick={() => {
        manage(projectId, "add-domain");
      }}
      pressable
      render={<button type="button" />}
      size="xs"
      title={<span className="text-primary">Put it on your domain</span>}
    />
  );
}

/** A place's public access as the account reads it: its status in words, its routes handed up. */
function PlaceAccess({
  projectId,
  filtering,
  onRoutes,
}: {
  readonly projectId: string;
  readonly filtering: boolean;
  readonly onRoutes: (
    projectId: string,
    routes: ReadonlyArray<ZeropsPublicRoute> | undefined,
  ) => void;
}) {
  const access = usePublicAccess(projectId);
  const routes = access.bound ? access.routes : undefined;
  useEffect(() => {
    onRoutes(projectId, routes);
  }, [onRoutes, projectId, routes]);
  if (filtering) return null;
  return (
    <div className="zerops-sites-access">
      <StopPublicAccessStatus access={access} />
    </div>
  );
}

/** A Mate's head: its face — its owner's initial on it where it is a colleague's — and its name. */
function MateHead({
  mate,
  title,
  owner,
  projectId,
}: {
  readonly mate: SitesMate | undefined;
  readonly title: string;
  readonly owner: string | undefined;
  readonly projectId: string;
}) {
  const mark = mate?.owner === undefined || mate.owner.isViewer ? undefined : ownerMark(mate.owner);
  return (
    <div className="zerops-sites-sectionhead">
      <Row
        className="flex-1"
        data-zerops-surface="sidebar-project-sites-mate"
        lead={
          <span className="zerops-sites-face">
            <MateFace shape={mate?.shape} size={16} state="idle" tint={mate?.tint ?? "slate"} />
            {mark === undefined ? null : (
              <span
                aria-hidden="true"
                className="zerops-sites-owner"
                style={{ "--person-hue": mark.hue } as CSSProperties}
              >
                {mark.initial}
              </span>
            )}
          </span>
        }
        size="xs"
        title={
          <>
            {title}
            {owner === undefined ? null : (
              <span className="zerops-sites-whose">{` · ${owner}'s`}</span>
            )}
          </>
        }
      />
      <ZeropsDoor name={title} projectId={projectId} />
    </div>
  );
}

/** A section's own way to Zerops: the mark at its head's end. */
function ZeropsDoor({ projectId, name }: { readonly projectId: string; readonly name: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={`Open ${name} in Zerops`}
            className="group/zerops"
            data-zerops-surface="sidebar-project-sites-zerops"
            render={<a href={zeropsProjectUrl(projectId)} rel="noreferrer" target="_blank" />}
            size="icon-sm"
            variant="ghost-muted"
          />
        }
      >
        {/* The mark repeats down the list: quiet until pointed at, then in its own colour. */}
        <ZeropsMark className="size-3.5 opacity-50 grayscale transition-[opacity,filter] duration-150 ease-out-strong group-hover/zerops:opacity-100 group-hover/zerops:grayscale-0 group-focus-visible/zerops:opacity-100 group-focus-visible/zerops:grayscale-0" />
      </TooltipTrigger>
      <TooltipPopup side="left">Open in Zerops</TooltipPopup>
    </Tooltip>
  );
}

/** What a row copies: its address, under its row's key. */
type CopiedLink = Pick<SitesLink, "key" | "url">;

/** `c` on a focused row, or ⌘C with nothing selected, copies its address. */
function copyOnKey(event: KeyboardEvent<HTMLElement>, onCopy: () => void) {
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
  const selected = window.getSelection?.()?.toString() ?? "";
  const copyKey =
    event.key.toLowerCase() === "c" &&
    (plain || ((event.metaKey || event.ctrlKey) && selected === ""));
  if (!copyKey) return;
  event.preventDefault();
  onCopy();
}

/**
 * An address's row: ↗ in the place mark's column, its service and host, opening in a new tab and
 * copying on `c` or ⌘C; its end keeps the room its copy button shows in.
 */
function SitesLinkRow({
  href,
  title,
  onCopyKey,
  ...trigger
}: Omit<ComponentProps<typeof Row>, "title"> & {
  readonly href: string;
  readonly title: ReactNode;
  readonly onCopyKey: () => void;
}) {
  return (
    <Row
      {...trigger}
      data-sites-nav=""
      data-zerops-surface="sidebar-project-sites-link"
      lead={<ArrowUpRightIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />}
      meta={<span aria-hidden="true" className="block w-6" />}
      onKeyDown={(event) => {
        copyOnKey(event, onCopyKey);
      }}
      pressable
      render={<a href={href} rel="noreferrer" target="_blank" />}
      size="xs"
      title={title}
    />
  );
}

/** A row's copy button, which its hover or focus shows and which says so once copied. */
function CopyButton({
  host,
  done,
  onCopy,
}: {
  readonly host: string;
  readonly done: boolean;
  readonly onCopy: () => void;
}) {
  return (
    <span className="zerops-sites-copy">
      <Button
        aria-label={`Copy ${host}`}
        data-zerops-surface="sidebar-project-sites-copy"
        onClick={onCopy}
        size={done ? "xs" : "icon-xs"}
        tabIndex={-1}
        variant="ghost-muted"
      >
        {done ? (
          <>
            <CheckIcon aria-hidden="true" />
            Copied
          </>
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </Button>
    </span>
  );
}

/**
 * A Mate's services, one row each as a place's addresses are: its hostname, its host, ↗ — opening
 * in a new tab, its other ports' hosts in its tooltip, copying on `c` or ⌘C. A service with
 * nothing to open is its hostname, muted, with why in its host's place: never only on a hover.
 */
function SitesServices({
  services,
  copied,
  onCopy,
}: {
  readonly services: ReadonlyArray<SitesService>;
  readonly copied: string | undefined;
  readonly onCopy: (link: CopiedLink) => void;
}) {
  return services.map((row) => {
    const { url } = row;
    const name = <span className="zerops-sites-service">{row.service}</span>;
    if (url === undefined)
      return (
        <div
          className="zerops-sites-linkrow"
          data-zerops-surface="sidebar-project-sites-service"
          key={row.key}
        >
          {/* The whole reason on a hover too, where a narrow popover cuts it. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Row
                  data-sites-off=""
                  lead={<span aria-hidden="true" />}
                  size="xs"
                  title={
                    <>
                      {name}
                      <span className="zerops-sites-host" data-sites-why="">
                        {row.why?.replace(/\.$/u, "")}
                      </span>
                    </>
                  }
                />
              }
            />
            <TooltipPopup side="top">{row.why}</TooltipPopup>
          </Tooltip>
        </div>
      );
    const done = copied === row.key;
    const host = row.host ?? url;
    const link = {
      href: url,
      onCopyKey: () => {
        onCopy({ key: row.key, url });
      },
      title: (
        <>
          {name}
          <span className="zerops-sites-host">{host}</span>
        </>
      ),
    };
    return (
      <div
        className="zerops-sites-linkrow"
        data-copied={done ? "" : undefined}
        data-zerops-surface="sidebar-project-sites-service"
        key={row.key}
      >
        {row.more.length === 0 ? (
          <SitesLinkRow {...link} />
        ) : (
          <Tooltip>
            <TooltipTrigger render={<SitesLinkRow {...link} />} />
            <TooltipPopup side="top">
              {[host, ...row.more].map((each) => (
                <div key={each}>{each}</div>
              ))}
            </TooltipPopup>
          </Tooltip>
        )}
        <CopyButton
          done={done}
          host={host}
          onCopy={() => {
            onCopy({ key: row.key, url });
          }}
        />
      </div>
    );
  });
}

/** A section's links: each opens in a new tab, and copies from its row. */
function SitesLinks({
  links,
  copied,
  onCopy,
  sayNone,
}: {
  /** `undefined` while unread. */
  readonly links: ReadonlyArray<SitesLink> | undefined;
  readonly copied: string | undefined;
  readonly onCopy: (link: CopiedLink) => void;
  /** A read place with no address says so; a Mate with none has no section. */
  readonly sayNone: boolean;
}) {
  if (links === undefined) {
    return (
      <p className="zerops-sites-quiet" data-zerops-surface="sidebar-project-sites-reading">
        Reading…
      </p>
    );
  }
  if (links.length === 0) {
    return sayNone ? <p className="zerops-sites-quiet">No public address yet</p> : null;
  }
  return links.map((link) => {
    const done = copied === link.key;
    return (
      <div className="zerops-sites-linkrow" data-copied={done ? "" : undefined} key={link.key}>
        <SitesLinkRow
          href={link.url}
          onCopyKey={() => {
            onCopy(link);
          }}
          title={
            <>
              <span className="zerops-sites-service">
                {link.service}
                {link.port === undefined ? null : (
                  <span className="zerops-envpop-port">:{link.port}</span>
                )}
              </span>
              <span className="zerops-sites-host">{link.host}</span>
            </>
          }
        />
        <CopyButton
          done={done}
          host={link.host}
          onCopy={() => {
            onCopy(link);
          }}
        />
      </div>
    );
  });
}

/**
 * The conversation header's Sites: the panel a row's globe opens, narrowed to production and this
 * conversation's own Mate. Each section's head carries its way to Zerops, so the header needs no
 * Open in Zerops of its own. The Mate's workspaces are read from the conversation it is in, the
 * one its person visits now.
 */
export function HeaderSites({
  sites,
  mateProjectId,
  threadKey,
  trigger,
  children,
}: {
  readonly sites: ProjectSitesInput;
  readonly mateProjectId: string;
  /** The conversation the header is in, by scoped key; absent, the Mate's last visited one. */
  readonly threadKey?: string | undefined;
  readonly trigger: ReactElement;
  readonly children: ReactNode;
}) {
  const mates = sites.mates
    .filter((mate) => mate.candidate.project.id === mateProjectId)
    .map((mate) => (threadKey === undefined ? mate : { ...mate, threadKey }));
  return (
    <SitesPopover mates={mates} sites={sites} surface="chat-header-sites" trigger={trigger}>
      {children}
    </SitesPopover>
  );
}

const NO_MATES: ReadonlyArray<SitesMate> = [];

/**
 * The whole project's Sites, from its own page's header: every address it answers at in one list,
 * grouped by where it runs — each place that has any, then each Mate with its previews. A place
 * with no address, and a Mate's service with nothing to open, are left out: the list says where
 * the project answers, and its places say their state on the page under it. `sites` is the project as the menu drew it
 * (`useProjectSitesOfGroup`).
 */
export function PageSites({
  sites,
  trigger,
  children,
}: {
  readonly sites: ProjectSitesInput;
  readonly trigger: ReactElement;
  readonly children: ReactNode;
}) {
  const { production, stages } = sites;
  const listed = useMemo((): ProjectSitesInput => {
    const answering = (model: ProjectSitesInput["production"]): ProjectSitesInput["production"] =>
      model === undefined
        ? undefined
        : (nowMs) => ({
            stops: model(nowMs).stops.filter((stop) => stop.routes.length > 0),
          });
    return {
      ...sites,
      // A place not read yet is not said here either: only where the project answers.
      line: undefined,
      production: answering(production),
      stages: answering(stages),
    };
  }, [production, sites, stages]);
  return (
    <SitesPopover
      answering
      mates={sites.mates}
      sites={listed}
      surface="project-sites"
      trigger={trigger}
    >
      {children}
    </SitesPopover>
  );
}

/**
 * One place's Sites, from a line or a page that names the place: the same panel, narrowed to that
 * place alone — its state, its addresses, and the way to manage them. `sites` is the project as
 * the menu drew it (`useProjectSitesOfGroup`).
 */
export function PlaceSites({
  sites,
  place,
  name,
  trigger,
  children,
}: {
  readonly sites: ProjectSitesInput;
  /** Which of the project's places: production, or the stage on this Zerops project. */
  readonly place: { readonly kind: "production" | "stage"; readonly projectId: string };
  /** The place as the line names it (`Production`). */
  readonly name: string;
  readonly trigger: ReactElement;
  readonly children: ReactNode;
}) {
  const { kind, projectId } = place;
  const { production, stages } = sites;
  const narrowed = useMemo(
    (): ProjectSitesInput => ({
      ...sites,
      // The other places are not said here, read or unread.
      line: undefined,
      production: kind === "production" ? production : undefined,
      stages:
        kind !== "stage" || stages === undefined
          ? undefined
          : (nowMs) => {
              const { stops } = stages(nowMs);
              const own = stops.filter((stop) => stop.projectId === projectId);
              // A stage the menu's model names otherwise is still among them: never an empty list
              // behind a line that shows an address.
              return { stops: own.length === 0 ? stops : own };
            },
    }),
    [kind, production, projectId, sites, stages],
  );
  return (
    <SitesPopover
      label={`Sites of ${name}`}
      mates={NO_MATES}
      sites={narrowed}
      surface="place-sites"
      trigger={trigger}
    >
      {children}
    </SitesPopover>
  );
}

/**
 * One Mate's Sites, from its card on its project's page: the same panel, narrowed to that Mate's
 * own workspaces and previews. The project's places are not said here: each has its own door on
 * its line.
 */
export function MateSites({
  sites,
  mateProjectId,
  name,
  trigger,
  children,
}: {
  readonly sites: ProjectSitesInput;
  readonly mateProjectId: string;
  /** The Mate as its card names it. */
  readonly name: string;
  readonly trigger: ReactElement;
  readonly children: ReactNode;
}) {
  const narrowed = useMemo(
    (): ProjectSitesInput => ({
      ...sites,
      line: undefined,
      production: undefined,
      stages: undefined,
    }),
    [sites],
  );
  const mates = useMemo(
    () => sites.mates.filter((mate) => mate.candidate.project.id === mateProjectId),
    [mateProjectId, sites.mates],
  );
  return (
    <SitesPopover
      label={`Sites of ${name}`}
      mates={mates}
      sites={narrowed}
      surface="mate-sites"
      trigger={trigger}
    >
      {children}
    </SitesPopover>
  );
}

/** The Sites panel in a popover of its own, under the door that opens it. */
function SitesPopover({
  sites,
  mates,
  surface,
  label,
  answering,
  trigger,
  children,
}: {
  readonly sites: ProjectSitesInput;
  /** The Mates whose sections it lists. */
  readonly mates: ReadonlyArray<SitesMate>;
  /** Only where the project answers: no service with nothing to open. */
  readonly answering?: boolean | undefined;
  readonly surface: string;
  /** Its accessible name; the project's sites where absent. */
  readonly label?: string;
  readonly trigger: ReactElement;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const close = () => {
    setOpen(false);
  };
  return (
    <Popover
      onOpenChange={(next) => {
        if (next) setQuery("");
        setOpen(next);
      }}
      open={open}
    >
      <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
      <PopoverPopup
        align="end"
        collisionPadding={8}
        padding="none"
        side="bottom"
        sideOffset={6}
        width="lg"
        aria-label={label ?? `Sites of ${sites.projectName}`}
        data-zerops-surface={surface}
      >
        <SitesPanel
          answering={answering}
          focusSection={undefined}
          groupId={sites.groupId}
          line={sites.line}
          mates={mates}
          onAskToFix={
            sites.onAskToFix === undefined
              ? undefined
              : (mateProjectId, problem) => {
                  close();
                  sites.onAskToFix?.(mateProjectId, problem);
                }
          }
          onOpenStop={(projectId) => {
            const opens = sites.onOpenStop(projectId);
            return opens === undefined
              ? undefined
              : () => {
                  close();
                  opens();
                };
          }}
          onClose={close}
          onQuery={setQuery}
          production={sites.production}
          projectName={sites.projectName}
          query={query}
          stages={sites.stages}
        />
      </PopoverPopup>
    </Popover>
  );
}

/** The open Git place holds the existing app-detail scope; the resting menu holds none. */
function GitPlaceEvidence({
  appId,
  git,
}: {
  readonly appId: string;
  readonly git: NonNullable<ChipMenuStop["git"]>;
}) {
  const detail = useHqAppDetail(appId);
  return git.environment === undefined ? null : (
    <GitDeliveryStatus
      environment={git.environment}
      delivery={git.delivery}
      repos={detail.repos ?? git.repos}
    />
  );
}
