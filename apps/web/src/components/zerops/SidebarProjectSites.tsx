/**
 * A project's places on its row (the menu by project): one popover of every address the app knows
 * for the project — production's, each stage's, every Mate's — with two doors to it. The globe sits
 * in the row's hover slot; the environment tag sits among the row's tags, only while a place is
 * not calm, and opens the popover at the section it speaks of.
 *
 * A place's section is what its chip's menu said (`ChipMenu`): its state, what went wrong, the fix
 * for the viewer's own Mate, its public access, its links and its way to Zerops. A Mate's section
 * is its own project's addresses, its dev and its pair's preview named. Each address is listed
 * once, opens in a new tab, and copies from its row (`c`, ⌘C, or the button its hover shows).
 *
 * What it says is `SidebarProjectSites.logic.ts`'s; this draws it.
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, GlobeIcon, SearchIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { isMacPlatform } from "~/lib/utils";
import type { FixProblem } from "~/zerops/fixRequest";
import { usePublicAccess } from "~/zerops/usePublicAccess";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ZeropsMark } from "../ZeropsMark";
import { MateFace } from "./primitives";
import { useHeadingLine } from "./SidebarHeadingLine";
import type { HeadingLineInput } from "./SidebarHeadingLine.logic";
import { ownerMark } from "./SidebarMateRow.logic";
import { AskToFix, ChipPortal, EnvDot, OpenInZerops, type ChipMate } from "./SidebarProductionChip";
import type { ChipMenuModel, ChipMenuStop, ProductionChip } from "./SidebarProductionChip.logic";
import {
  filterSites,
  productionUrl,
  projectSitesSections,
  projectSitesStatus,
  sitesLinkCount,
  type SitesLink,
  type SitesMateFacts,
  type SitesStatus,
} from "./SidebarProjectSites.logic";
import { StopPublicAccessStatus } from "./StopPublicAccess";
import { StopReadAgain } from "./StopReadAgain";

/** One of the project's Mates, as its section and the fix list it. */
export interface SitesMate extends ChipMate {
  /** The listing's row (`ZeropsCandidatePresentation`): its routes and services where read. */
  readonly candidate: ChipMate["candidate"] & {
    readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
    readonly services?: { readonly hostnames: ReadonlyArray<string> };
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
  /** Production's and the stages' chips as drawn (`drawnChip`, already `asLastKnown` while HQ is paused), for the environment tag. */
  readonly prodChip: ProductionChip | undefined;
  readonly stageChip: ProductionChip | undefined;
  /** The heading line's input (`HeadingLineInput`): what comes up, lands, deploys. */
  readonly line: HeadingLineInput | undefined;
  readonly onAskToFix: ((mateProjectId: string, problem: FixProblem) => void) | undefined;
  /** A stop's own page, where one opens. */
  readonly onOpenStop: (projectId: string) => (() => void) | undefined;
}

/** More addresses than this, and a filter sits under the popover's title. */
const FILTER_FROM = 9;
/** How long a copied address says so. */
const COPIED_MS = 1_200;
/** How long the section the tag spoke of stays lit. */
const FLASH_MS = 1_200;

const firstName = (name: string) => name.trim().split(/\s+/u)[0] ?? name;

const factsOf = (mate: SitesMate): SitesMateFacts => ({
  projectId: mate.candidate.project.id,
  name: mate.name,
  owner: mate.owner === undefined || mate.owner.isViewer ? undefined : firstName(mate.owner.name),
  routes: mate.candidate.routes,
  hostnames: mate.candidate.services?.hostnames,
  controlPlane: mate.candidate.service?.name,
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

  // What the doors say needs no moment: addresses do not age.
  const atRest = projectSitesSections({
    production: production?.(0),
    productionUnread: false,
    stages: stages?.(0),
    unreadStages: [],
    placeRoutes: (stop) => stop.routes,
    mates: mates.map(factsOf),
  });
  const reading = atRest.some((section) => section.links === undefined);
  const none = !reading && sitesLinkCount(atRest) === 0;
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
          <PopoverPrimitive.Trigger
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
              <button
                aria-label={`Addresses of ${projectName}`}
                className="zerops-sites-globe"
                data-empty={none ? "" : undefined}
                data-zerops-surface="sidebar-project-sites"
                type="button"
              />
            }
          />
        }
      >
        <GlobeIcon aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      {open ? null : <TooltipPopup side="bottom">{globeTip}</TooltipPopup>}
    </Tooltip>
  );
  const tag =
    shown === undefined ? null : (
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverPrimitive.Trigger
              id={tagId}
              render={
                <button
                  aria-label={shown.sentence}
                  className="zerops-sites-tag"
                  data-tone={shown.tone}
                  data-zerops-surface="sidebar-project-env-tag"
                  type="button"
                />
              }
            />
          }
        >
          <EnvDot dot={shown.dot} />
          {/* In a narrow menu the dot alone stands for it; the tooltip and its name say the rest. */}
          <span className="menu-tag-word">{shown.word}</span>
        </TooltipTrigger>
        {open ? null : <TooltipPopup side="bottom">{shown.sentence}</TooltipPopup>}
      </Tooltip>
    );
  const focusSection = door === "tag" ? shown?.section : undefined;

  return (
    <PopoverPrimitive.Root
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
      {children({ tag, globe })}
      <ChipPortal>
        <PopoverPrimitive.Positioner
          align="end"
          className="z-130"
          // Kept at the door's end and slid to fit, never flipped to its start: the popover stays over the menu.
          collisionAvoidance={{ side: "flip", align: "shift" }}
          collisionPadding={8}
          side="bottom"
          sideOffset={6}
        >
          <PopoverPrimitive.Popup
            aria-label={`Addresses of ${projectName}`}
            className="zerops-sites"
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
              onQuery={setQuery}
              production={production}
              projectName={projectName}
              query={query}
              stages={stages}
            />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </ChipPortal>
    </PopoverPrimitive.Root>
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
  onAskToFix,
  onOpenStop,
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
  readonly onAskToFix: ProjectSitesInput["onAskToFix"];
  readonly onOpenStop: ProjectSitesInput["onOpenStop"];
}) {
  const [openedAt] = useState(Date.now);
  const prod = production?.(openedAt);
  const stg = stages?.(openedAt);
  // Each place's public access as read, over what its listing holds (`PlaceAccess`).
  const [bound, setBound] = useState<ReadonlyMap<string, ReadonlyArray<ZeropsPublicRoute>>>(
    () => new Map(),
  );
  const sections = projectSitesSections({
    production: prod,
    productionUnread: prod === undefined && line?.production !== undefined,
    stages: stg,
    unreadStages: stg === undefined ? (line?.stages.map((stage) => stage.name) ?? []) : [],
    placeRoutes: (stop) =>
      (stop.projectId === undefined ? undefined : bound.get(stop.projectId)) ?? stop.routes,
    mates: mates.map(factsOf),
  });
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
  const copy = (link: SitesLink) => {
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
      <div className="zerops-sites-head">
        <h5 className="zerops-sites-title">{projectName}</h5>
        {total === 0 ? null : (
          <span className="zerops-sites-count">
            {total === 1 ? "1 address" : `${String(total)} addresses`}
          </span>
        )}
      </div>
      {total < FILTER_FROM ? null : (
        <label className="zerops-sites-filter">
          <SearchIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <input
            aria-label="Filter addresses"
            data-sites-filter=""
            onChange={(event) => {
              onQuery(event.target.value);
            }}
            placeholder="Filter addresses"
            ref={filter}
            spellCheck={false}
            type="text"
            value={query}
          />
        </label>
      )}
      <div className="zerops-sites-scroll" ref={scroll}>
        {sections.length === 0 ? (
          <div className="zerops-sites-empty" data-zerops-surface="sidebar-project-sites-empty">
            <p>No public addresses yet</p>
            <span>A service shows here once it has a public address.</span>
            {first === undefined ? null : <OpenInZerops projectId={first.candidate.project.id} />}
          </div>
        ) : filtering && kept.size === 0 ? (
          <p className="zerops-sites-empty" data-zerops-surface="sidebar-project-sites-nomatch">
            {`No address matches “${query.trim()}”`}
          </p>
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
                  {body}
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

/** A place's section: its head, what went wrong and the fix, its public access, its links. */
function PlaceSection({
  stop,
  title,
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
  const projectId = stop?.projectId;
  const opens = projectId === undefined ? undefined : onOpenStop(projectId);
  const row = (
    <>
      <EnvDot dot={stop?.dot ?? "off"} />
      <span className="min-w-0 truncate">
        <b className="font-medium">{title}</b>
        {stop?.version === undefined ? null : (
          <span className="zerops-envpop-version">{stop.version}</span>
        )}
      </span>
      <span className="zerops-envpop-word" data-tone={stop?.tone ?? "muted"}>
        {stop?.word ?? "Reading…"}
      </span>
    </>
  );
  return (
    <>
      <div className="zerops-sites-sectionhead">
        {opens === undefined ? (
          <div className="zerops-sites-place" data-zerops-surface="sidebar-project-sites-place">
            {row}
          </div>
        ) : (
          <button
            className="zerops-sites-place zerops-envpop-press"
            data-sites-nav=""
            data-zerops-surface="sidebar-project-sites-place"
            onClick={opens}
            type="button"
          >
            {row}
          </button>
        )}
        {projectId === undefined ? null : <ZeropsDoor name={title} projectId={projectId} />}
      </div>
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
      {projectId === undefined ? null : (
        <PlaceAccess filtering={filtering} onRoutes={onRoutes} projectId={projectId} />
      )}
      {children}
    </>
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
      <div className="zerops-sites-mate" data-zerops-surface="sidebar-project-sites-mate">
        <span className="zerops-sites-face">
          <MateFace
            className="size-4"
            shape={mate?.shape}
            size="dot"
            state="idle"
            tint={mate?.tint ?? "slate"}
          />
          {mark === undefined ? null : (
            <span
              aria-hidden="true"
              className="zerops-sites-owner"
              style={{ "--menu-owner-hue": mark.hue } as CSSProperties}
            >
              {mark.initial}
            </span>
          )}
        </span>
        <span className="min-w-0 truncate">
          <b className="font-medium">{title}</b>
          {owner === undefined ? null : (
            <span className="zerops-sites-whose">{` · ${owner}'s`}</span>
          )}
        </span>
      </div>
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
          <a
            aria-label={`Open ${name} in Zerops`}
            className="zerops-sites-zerops"
            data-zerops-surface="sidebar-project-sites-zerops"
            href={zeropsProjectUrl(projectId)}
            rel="noreferrer"
            target="_blank"
          />
        }
      >
        <ZeropsMark className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="left">Open in Zerops</TooltipPopup>
    </Tooltip>
  );
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
  readonly onCopy: (link: SitesLink) => void;
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
        <a
          className="zerops-sites-link"
          data-sites-nav=""
          data-zerops-surface="sidebar-project-sites-link"
          href={link.url}
          onKeyDown={(event) => {
            const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
            const selected = window.getSelection?.()?.toString() ?? "";
            const copyKey =
              event.key.toLowerCase() === "c" &&
              (plain || ((event.metaKey || event.ctrlKey) && selected === ""));
            if (!copyKey) return;
            event.preventDefault();
            onCopy(link);
          }}
          rel="noreferrer"
          target="_blank"
        >
          <span className="zerops-sites-service">
            {link.service}
            {link.port === undefined ? null : (
              <span className="zerops-envpop-port">:{link.port}</span>
            )}
          </span>
          {link.role === undefined ? null : <span className="zerops-sites-role">{link.role}</span>}
          <span className="zerops-sites-host">{link.host}</span>
          <ArrowUpRightIcon aria-hidden="true" className="zerops-sites-arrow" />
        </a>
        <button
          aria-label={`Copy ${link.host}`}
          className="zerops-sites-copy"
          data-zerops-surface="sidebar-project-sites-copy"
          onClick={() => {
            onCopy(link);
          }}
          tabIndex={-1}
          type="button"
        >
          {done ? (
            <>
              <CheckIcon aria-hidden="true" className="size-3.5" />
              Copied
            </>
          ) : (
            <CopyIcon aria-hidden="true" className="size-3.5" />
          )}
        </button>
      </div>
    );
  });
}
