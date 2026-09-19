/**
 * The menu's foot: whose work this is, whose organization's projects are
 * listed above, and everything the foot used to spend a glyph each on.
 *
 * Four unlabelled glyphs said nothing about the account and nothing about the
 * organization — and the organization decides every row in the menu, so a
 * person could read someone else's projects with nothing on screen saying so.
 * One row says both, in the two lines a messenger uses for a person, and the
 * places fold into its menu where a name is cheaper than a glyph.
 *
 * Collapsed, the row is the picture alone: one mark of identity reads better
 * on a rail than four anonymous glyphs did.
 */

import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { cn } from "~/lib/utils";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { useSidebar } from "../ui/sidebar";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Avatar } from "./primitives";
import {
  zeropsAccountDisplay,
  type ZeropsAccountDisplay,
} from "./landing/ZeropsAccountControl.logic";
import {
  SIDEBAR_ACCOUNT_DESTINATIONS,
  sidebarAccountDestinationOf,
  sidebarAccountLines,
  sidebarAccountOrganizationChoices,
  type SidebarAccountDestination,
} from "./SidebarZeropsAccount.logic";

export interface SidebarZeropsAccountProps {
  readonly account: ZeropsAccountDisplay;
  readonly organizations: ReadonlyArray<ZeropsOrganization>;
  readonly activeOrganization: ZeropsOrganization | null;
  /** The page open now, so the menu lights the row that names it. */
  readonly destination: SidebarAccountDestination["id"] | null;
  /** Icons stay the caller's: this module owns no icon map (design-system §3). */
  readonly destinationIcon: (id: SidebarAccountDestination["id"]) => ReactNode;
  readonly onSelectOrganization: (membershipId: string) => void;
  readonly onGo: (destination: SidebarAccountDestination) => void;
  readonly onSignOut: () => void;
  readonly signingOut?: boolean;
  readonly signOutError?: string | null;
  /** The rail: the picture alone, with the name only in the tooltip's place. */
  readonly collapsed?: boolean;
}

export function SidebarZeropsAccount({
  account,
  organizations,
  activeOrganization,
  destination,
  destinationIcon,
  onSelectOrganization,
  onGo,
  onSignOut,
  signingOut = false,
  signOutError = null,
  collapsed = false,
}: SidebarZeropsAccountProps) {
  const lines = sidebarAccountLines({ name: account.name, organization: activeOrganization });

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Account: ${account.name}`}
        className={cn(
          "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left outline-none transition-colors select-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-active",
          collapsed && "justify-center",
        )}
        data-zerops-surface="sidebar-account"
      >
        <Avatar initials={account.initials} src={account.avatarUrl} />
        {collapsed ? null : (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="min-w-0 truncate text-[13px] leading-4 font-medium text-sidebar-foreground">
                {lines.name}
              </span>
              {/* An organization still being resolved is absent, never a
                  placeholder: the foot must paint nothing it takes back. */}
              {lines.organization === null ? null : (
                <span
                  className="min-w-0 truncate text-[11px] leading-4 text-sidebar-muted-foreground"
                  data-zerops-surface="sidebar-account-organization"
                >
                  {lines.organization}
                </span>
              )}
            </span>
            <ChevronsUpDownIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-sidebar-muted-foreground"
            />
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start" className="w-64" side="top">
        <SidebarZeropsAccountMenu
          account={account}
          activeOrganization={activeOrganization}
          destination={destination}
          destinationIcon={destinationIcon}
          onGo={onGo}
          onSelectOrganization={onSelectOrganization}
          onSignOut={onSignOut}
          organizations={organizations}
          signingOut={signingOut}
          signOutError={signOutError}
        />
      </MenuPopup>
    </Menu>
  );
}

/**
 * The menu's body: who, then which organization, then where to go, then the
 * way out. Split from the trigger so it can be rendered — and read — without
 * a popup being open.
 */
export function SidebarZeropsAccountMenu({
  account,
  organizations,
  activeOrganization,
  destination,
  destinationIcon,
  onSelectOrganization,
  onGo,
  onSignOut,
  signingOut = false,
  signOutError = null,
}: Omit<SidebarZeropsAccountProps, "collapsed">) {
  const choices = sidebarAccountOrganizationChoices(organizations);
  return (
    <>
      <div className="flex items-center gap-3 px-2 py-2" data-zerops-account-identity="true">
        <Avatar initials={account.initials} size="md" src={account.avatarUrl} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {account.fullName ?? account.name}
          </p>
          {account.email === null ? null : (
            <p className="truncate text-xs text-muted-foreground">{account.email}</p>
          )}
        </div>
      </div>

      {choices.length === 0 ? null : (
        <>
          <MenuSeparator />
          <MenuRadioGroup
            onValueChange={(value) => {
              onSelectOrganization(value as string);
            }}
            value={activeOrganization?.membershipId ?? ""}
          >
            <MenuGroupLabel>Organization</MenuGroupLabel>
            {choices.map((organization) => (
              <MenuRadioItem
                closeOnClick
                key={organization.membershipId}
                value={organization.membershipId}
              >
                <span className="min-w-0 truncate">{organization.name}</span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </>
      )}

      <MenuSeparator />
      {SIDEBAR_ACCOUNT_DESTINATIONS.map((entry) => (
        <MenuItem
          data-zerops-account-destination={entry.id}
          key={entry.id}
          onClick={() => {
            onGo(entry);
          }}
        >
          {destinationIcon(entry.id)}
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          {destination === entry.id ? (
            <span className="text-[11px] text-muted-foreground">Open</span>
          ) : null}
        </MenuItem>
      ))}

      <MenuSeparator />
      {/* Sign-out keeps the menu open so the busy and failed states show
            where the click landed; success unmounts the row with the session. */}
      <MenuItem
        closeOnClick={false}
        disabled={signingOut}
        onClick={onSignOut}
        variant={signOutError === null ? "default" : "destructive"}
      >
        <LogOutIcon />
        {signOutError === null ? "Sign out" : "Sign out failed. Try again"}
      </MenuItem>
    </>
  );
}

/**
 * The row wired to the session and the router.
 *
 * Renders nothing while nobody is signed in: the foot of a signed-out menu
 * has no account to name, and the door is the whole screen anyway.
 */
export function SidebarZeropsAccountRow({
  destinationIcon,
}: {
  readonly destinationIcon: (id: SidebarAccountDestination["id"]) => ReactNode;
}) {
  // Optional on purpose: the foot renders in the shell, and a shell that
  // white-screens because no session is mounted is worse than one with no
  // account row. Signed out, there is no account to name either way.
  const session = useZeropsSessionOptional();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const destination = useLocation({
    select: (location) => sidebarAccountDestinationOf(location.pathname),
  });
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  if (session === null || session.status !== "signed-in") return null;
  const { user, organizations, activeOrganization, selectOrganization, signOut } = session;

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarZeropsAccount
      account={zeropsAccountDisplay(user)}
      activeOrganization={activeOrganization}
      collapsed={!isMobile && state === "collapsed"}
      destination={destination}
      destinationIcon={destinationIcon}
      onGo={(entry) => {
        closeMobile();
        void navigate({ to: entry.to });
      }}
      onSelectOrganization={(membershipId) => {
        void selectOrganization(membershipId);
      }}
      onSignOut={() => {
        setSigningOut(true);
        setSignOutError(null);
        void signOut()
          .catch((cause: unknown) => {
            setSignOutError(zeropsErrorMessage(cause));
          })
          .finally(() => {
            setSigningOut(false);
          });
      }}
      organizations={organizations}
      signingOut={signingOut}
      signOutError={signOutError}
    />
  );
}
