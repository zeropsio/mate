/**
 * The Mate's public addresses in the conversation's top bar: one compact
 * control, its sites grouped by environment as the panel's Browser groups them
 * (`browserSiteGroups`), each its service's name above its address. A pick opens
 * it as its own tab in the panel's Browser; the row's arrow, or ⌘-click, opens
 * it in a new browser tab. Nothing is drawn while the Mate has no address.
 *
 * The owner, 2026-10-03: "I also question whether ability to open public
 * links shouldnt be in top bar of the main convo".
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ChevronDownIcon, GlobeIcon, LayoutDashboardIcon } from "lucide-react";

import { useMateAddresses } from "~/zerops/useMateAddresses";
import type { ProjectSitesInput } from "../zerops/SidebarProjectSites";
import { HeaderSites } from "../zerops/SidebarProjectSites";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { browserSiteGroups } from "../zerops/browserSites.logic";
import { MateAddressExternalLink, openMateAddress } from "../zerops/MateAddresses";

export function ChatHeaderLinks({
  environmentId,
  threadId,
  sites,
  mateProjectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The menu's panel of this Mate's project (`useProjectSitesOf`): where drawn, Sites opens it. */
  readonly sites?: ProjectSitesInput | undefined;
  readonly mateProjectId?: string | undefined;
}) {
  const { addresses } = useMateAddresses(environmentId, threadId);
  if (sites !== undefined && mateProjectId !== undefined) {
    return (
      <>
        <ProjectPageLink sites={sites} />
        <HeaderSites
          mateProjectId={mateProjectId}
          sites={sites}
          threadKey={scopedThreadKey(scopeThreadRef(environmentId, threadId))}
          trigger={
            <Button
              aria-label="Open the Mate's sites"
              data-chat-header-ghost
              size="sm"
              variant="ghost"
            />
          }
        >
          <GlobeIcon className="size-3.5 shrink-0" />
          <span className="hidden text-line @3xl/header-actions:inline">Sites</span>
          <ChevronDownIcon className="size-3 shrink-0 opacity-70" />
        </HeaderSites>
      </>
    );
  }
  if (addresses.length === 0) return null;
  const threadRef = scopeThreadRef(environmentId, threadId);
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label="Open the Mate's sites"
            data-chat-header-ghost
            size="sm"
            variant="ghost"
          />
        }
      >
        <GlobeIcon className="size-3.5 shrink-0" />
        <span className="hidden text-line @3xl/header-actions:inline">Sites</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="end" aria-label="The Mate's sites" className="w-72">
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
                  <span className="truncate text-muted-foreground text-xs">{address.host}</span>
                </span>
                <MateAddressExternalLink address={address} />
              </MenuItem>
            ))}
          </MenuGroup>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/**
 * The project's own page, one press from its Mate's conversation, just before Sites — the menu
 * row's door to it, with its icon (the owner, 2026-10-18: "we should add a link to project detail
 * somewhere to the app bar"). Drawn only where the menu draws that door: a Mate in a project.
 */
export function ProjectPageLink({ sites }: { readonly sites: ProjectSitesInput | undefined }) {
  const open = sites?.onOpenPage;
  if (sites === undefined || open === undefined) return null;
  const label = `Open ${sites.projectName}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            data-chat-header-ghost
            data-zerops-surface="header-project-page"
            onClick={open}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <LayoutDashboardIcon aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
