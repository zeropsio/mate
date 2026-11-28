/**
 * The Mate's public addresses in the conversation's top bar: one compact
 * control, its sites grouped by environment as the panel's Browser groups them
 * (`browserSiteGroups`), each its service's name above its address. A pick opens
 * it as its own tab in the panel's Browser; the row's arrow, or ⌘-click, opens
 * it in a new browser tab. Nothing is drawn while the Mate has no address. In a project with a
 * page, *Board* and *Project* stand before it and Sites opens the menu's panel of the project.
 *
 * The owner, 2026-10-03: "I also question whether ability to open public
 * links shouldnt be in top bar of the main convo".
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, GlobeIcon, LayoutDashboardIcon } from "lucide-react";
import { cloneElement, type ReactNode } from "react";

import type { MateProjectPage } from "~/zerops/mateIdentities";
import { useMateAddresses } from "~/zerops/useMateAddresses";
import type { ProjectSitesInput } from "../zerops/SidebarProjectSites";
import { HeaderSites } from "../zerops/SidebarProjectSites";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { browserSiteGroups } from "../zerops/browserSites.logic";
import { BoardDoor } from "../zerops/projectAutomation/BoardDoor";
import { useBoardWaitingCount } from "../zerops/projectAutomation/ProjectAutomation";
import { MateAddressExternalLink, openMateAddress } from "../zerops/MateAddresses";
import { Text } from "~/components/ui/text";

/** The Sites button, the same whichever panel it opens. */
const sitesButton = (
  <Button
    aria-label="Open the Mate's sites"
    // A phone's line holds the Mate, what waits on the person, the menu and the panel's toggle:
    // Sites stands there only while the Mate's name is alone on it. A Review, a task's state or a
    // crew takes its room; the menu's row and the panel's Browser still lead to every address.
    className="max-sm:[[data-chat-header]:has([data-conversation-strip]_:is([data-chat-header-review],[data-zerops-surface=mate-task-session],[data-conversation-crew]))_&]:hidden"
    data-header-sites=""
    size="sm"
    variant="sidebar"
  />
);
const sitesWords = (
  <>
    <GlobeIcon className="size-3.5 shrink-0" />
    <span className="hidden text-line @3xl/header-actions:inline">Sites</span>
    <ChevronDownIcon className="size-3 shrink-0 opacity-70" />
  </>
);
/** The Sites button alone, without a panel to open: the design harnesses' header. */
export function SitesButtonView() {
  return cloneElement(sitesButton, undefined, sitesWords);
}
const projectWords = (
  <>
    <LayoutDashboardIcon aria-hidden="true" className="size-3.5 shrink-0" />
    {/* Its word as Sites has its own, given way together in a narrow header. */}
    <span className="hidden text-line @3xl/header-actions:inline">Project</span>
  </>
);

/**
 * A link's room before the link is known to stand there: its own shape, unseen and out of reach,
 * so the header's line is already as wide as it will be and nothing on it moves when the link
 * arrives. The header never shows a link it would take back.
 */
function HeldLink({ children }: { readonly children: ReactNode }) {
  return (
    <span aria-hidden="true" className="invisible contents" data-header-link-held="" inert>
      {children}
    </span>
  );
}

/**
 * The header's links for the Mate that lives here, decided from who the Mate is (`page`,
 * `mateProjectPage`) on the first frame:
 *
 * - its project has a page: its application's *Board* and *Project*, at once, and *Sites* — the
 *   menu's panel of the project once the menu has drawn it (`sites`), the Mate's own addresses
 *   where they are read first, else its room held;
 * - not known yet: every room held, nothing in them;
 * - no project page, or no Mate: the Mate's own addresses, where it has any.
 */
export function ChatHeaderLinks({
  environmentId,
  threadId,
  page,
  sites,
  mateProjectId,
  projectInMenu = false,
}: {
  /** A phone's header carries the project's page in its menu (`ChatHeader`): no door, no room. */
  readonly projectInMenu?: boolean;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** Whether the Mate's project has its own page; absent where no Mate of a project lives here. */
  readonly page?: MateProjectPage | undefined;
  /** The menu's panel of this Mate's project (`useProjectSitesOf`): where drawn, Sites opens it. */
  readonly sites?: ProjectSitesInput | undefined;
  readonly mateProjectId?: string | undefined;
}) {
  const { addresses } = useMateAddresses(environmentId);
  const navigate = useNavigate();
  const threadRef = scopeThreadRef(environmentId, threadId);
  const sitesControl =
    page?.kind === "page" && sites !== undefined && mateProjectId !== undefined ? (
      <HeaderSites
        mateProjectId={mateProjectId}
        sites={sites}
        threadKey={scopedThreadKey(threadRef)}
        trigger={sitesButton}
      >
        {sitesWords}
      </HeaderSites>
    ) : addresses.length === 0 ? null : (
      <Menu>
        <MenuTrigger render={sitesButton}>{sitesWords}</MenuTrigger>
        <MenuPopup align="end" aria-label="The Mate's sites" width="md">
          {browserSiteGroups(addresses).map((group) => (
            <MenuGroup data-browser-site-group={group.key} key={group.key}>
              <MenuGroupLabel>{group.title}</MenuGroupLabel>
              {group.rows.map(({ address, name }) => (
                <MenuItem
                  data-mate-address={address.service}
                  key={address.url}
                  onAuxClick={(event) => openMateAddress(threadRef, address, event)}
                  onClick={(event) => openMateAddress(threadRef, address, event)}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-foreground">{name}</span>
                    <Text truncate variant="note">
                      {address.host}
                    </Text>
                  </span>
                  <MateAddressExternalLink address={address} />
                </MenuItem>
              ))}
            </MenuGroup>
          ))}
        </MenuPopup>
      </Menu>
    );
  return (
    <HeaderLinksView
      board={
        page?.kind === "page" && !projectInMenu ? <HeaderBoardDoor groupId={page.groupId} /> : null
      }
      onOpenProject={(groupId) => {
        void navigate({ to: "/group/$groupId/flow", params: { groupId } });
      }}
      page={page}
      projectInMenu={projectInMenu}
      sites={sitesControl}
    />
  );
}

/** The application's Board, with how many of its tasks wait for the reader. */
function HeaderBoardDoor({ groupId }: { readonly groupId: string }) {
  return <BoardDoor count={useBoardWaitingCount(groupId)} groupId={groupId} place="header" />;
}

/**
 * The links as drawn, from what is known: `sites` is the Sites control where there is one to
 * press, `board` the application's Board door. A project with a page holds Sites' room until then;
 * a project not known yet holds every room.
 */
export function HeaderLinksView({
  page,
  sites,
  board = null,
  onOpenProject,
  projectInMenu = false,
}: {
  readonly projectInMenu?: boolean;
  readonly page: MateProjectPage | undefined;
  readonly sites: ReactNode;
  /** The application's Board door (`BoardDoor`), for a Mate whose project has a page. */
  readonly board?: ReactNode;
  readonly onOpenProject: (groupId: string) => void;
}) {
  if (page?.kind === "unknown") {
    return (
      <HeldLink>
        {projectInMenu ? null : (
          <>
            <BoardDoor count={undefined} groupId={null} place="header" />
            <Button size="sm" variant="sidebar">
              {projectWords}
            </Button>
          </>
        )}
        <Button size="sm" variant="sidebar">
          {sitesWords}
        </Button>
      </HeldLink>
    );
  }
  if (page?.kind !== "page") return sites;
  const { groupId } = page;
  return (
    <>
      {board}
      {projectInMenu ? null : (
        <ProjectPageLink
          onOpen={() => {
            onOpenProject(groupId);
          }}
          projectName={page.projectName}
        />
      )}
      {sites ?? (
        <HeldLink>
          <Button size="sm" variant="sidebar">
            {sitesWords}
          </Button>
        </HeldLink>
      )}
    </>
  );
}

/**
 * The project's own page, one press from its Mate's conversation, just before Sites — the menu
 * row's door to it, with its icon (the owner, 2026-10-18: "we should add a link to project detail
 * somewhere to the app bar"). Drawn only for a Mate in a project: `onOpen` absent, no door.
 */
export function ProjectPageLink({
  projectName,
  onOpen,
}: {
  readonly projectName: string | undefined;
  readonly onOpen: (() => void) | undefined;
}) {
  if (onOpen === undefined) return null;
  const label = projectName === undefined ? "Open the project" : `Open ${projectName}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            data-zerops-surface="header-project-page"
            onClick={onOpen}
            size="sm"
            variant="sidebar"
          />
        }
      >
        {projectWords}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
