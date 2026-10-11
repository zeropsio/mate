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
 * The viewer's photo, name and role ("Owner of Acme"), then one ··· whose menu holds Show and
 * Order, the organization, the places and Sign out. On the rail the photo alone opens it.
 */

import { useLocation, useNavigate } from "@tanstack/react-router";
import { EllipsisIcon, KeyRoundIcon, LogOutIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import {
  PROJECT_ORDER_CHOICES,
  readProjectsOnScreen,
  useProjectOrder,
} from "~/zerops/projectOrderPreference";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { MATE_SCOPE_CHOICES, useMateScope } from "~/zerops/mateScope";
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
  MenuSwitch,
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
  sidebarAccountRoleLine,
  sidebarAccountRoleParts,
  signInTokensWords,
  type SidebarAccountDestination,
  type SignInTokensCleanup,
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
  /** Cleaning up the person's own sign-in tokens, and how it goes; absent where it cannot run. */
  readonly cleanup?:
    | { readonly state: SignInTokensCleanup; readonly onCleanUp: () => void }
    | undefined;
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
  cleanup,
  collapsed = false,
}: SidebarZeropsAccountProps) {
  const lines = sidebarAccountLines({ name: account.name, organization: activeOrganization });
  const role = sidebarAccountRoleParts(activeOrganization);
  const menu = (
    <MenuPopup align={collapsed ? "start" : "end"} className="w-72" side="top">
      <SidebarZeropsAccountMenu
        account={account}
        activeOrganization={activeOrganization}
        cleanup={cleanup}
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
  );

  // The rail: the picture alone opens the menu.
  if (collapsed) {
    return (
      <Menu>
        <MenuTrigger
          render={
            <button
              aria-label={`Account: ${account.name}`}
              className="menu-foot-photo"
              data-zerops-surface="sidebar-account"
              type="button"
            />
          }
        >
          <Avatar initials={account.initials} size="md" src={account.avatarUrl} />
        </MenuTrigger>
        {menu}
      </Menu>
    );
  }

  // The viewer's photo, name and role are the one control, its ··· the sign that it opens: how the
  // list reads, the organization, the places, and the way out.
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            aria-label={`Account: ${account.name}`}
            className="menu-foot-who"
            data-zerops-surface="sidebar-account"
            type="button"
          />
        }
      >
        <Avatar initials={account.initials} size="md" src={account.avatarUrl} />
        <span className="menu-foot-lines">
          <span className="menu-foot-name">{lines.name}</span>
          {/* An organization still being resolved is absent, never a placeholder: the foot must
              paint nothing it takes back. */}
          {role === null ? null : (
            <span className="menu-foot-role" data-zerops-surface="sidebar-account-role">
              {role.before}
              <span data-zerops-surface="sidebar-account-organization">{role.organization}</span>
              {role.after}
            </span>
          )}
        </span>
        <span aria-hidden="true" className="menu-foot-button">
          <EllipsisIcon className="size-4" />
        </span>
      </MenuTrigger>
      {menu}
    </Menu>
  );
}

/**
 * The menu's body: who, then how the list above reads, then which
 * organization, then where to go, then the way out. Split from the trigger so
 * it can be rendered — and read — without a popup being open.
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
  cleanup,
}: Omit<SidebarZeropsAccountProps, "collapsed">) {
  const choices = sidebarAccountOrganizationChoices(organizations);
  const projectOrder = useProjectOrder();
  const [mateScope, setMateScope] = useMateScope();
  return (
    <>
      <div className="flex items-center gap-3 px-2 py-2" data-zerops-account-identity="true">
        <Avatar initials={account.initials} size="md" src={account.avatarUrl} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {account.fullName ?? account.name}
          </p>
          {/* What they are in the organization the list shows, as the prototype
              said it; the address where no organization is known yet. */}
          {(sidebarAccountRoleLine(activeOrganization) ?? account.email) === null ? null : (
            <p className="truncate text-xs text-muted-foreground">
              {sidebarAccountRoleLine(activeOrganization) ?? account.email}
            </p>
          )}
        </div>
      </div>

      {/* How the list above reads — whose Mates, and in which order the
          projects — both set once and left alone, so they live here rather
          than as chrome over the list; moving one project is the project's own
          heading and menu. *Custom* starts from the order on screen
          (`projectOrderPreference.ts`). */}
      <MenuSeparator />
      {/* Each a switch, as the approved prototype drew them: its label, then
          its choices on one track with the chosen one raised — a list of
          radio rows only greyed the chosen one, which read as the pointer
          (the owner, 2026-09-28: "much more shit"). Still the menu's own
          radio items, so the keys and the reader treat them as before; the
          menu stays open to show the list changing under it. */}
      <MenuSwitch
        label="Show"
        onValueChange={(value) => {
          const choice = MATE_SCOPE_CHOICES.find((entry) => entry.value === value);
          if (choice !== undefined) setMateScope(choice.value);
        }}
        value={mateScope}
      >
        {MATE_SCOPE_CHOICES.map((choice) => (
          <MenuRadioItem
            closeOnClick={false}
            data-zerops-account-scope={choice.value}
            key={choice.value}
            value={choice.value}
            variant="segment"
          >
            {choice.label}
          </MenuRadioItem>
        ))}
      </MenuSwitch>
      <MenuSwitch
        label="Order"
        onValueChange={(value) => {
          const choice = PROJECT_ORDER_CHOICES.find((entry) => entry.value === value);
          if (choice !== undefined) projectOrder.choose(choice.value, readProjectsOnScreen());
        }}
        value={projectOrder.order}
      >
        {PROJECT_ORDER_CHOICES.map((choice) => (
          <MenuRadioItem
            closeOnClick={false}
            data-zerops-account-order={choice.value}
            key={choice.value}
            value={choice.value}
            variant="segment"
          >
            {choice.label}
          </MenuRadioItem>
        ))}
      </MenuSwitch>

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
            {/* The one the list shows wears a check, as the prototype drew it:
                a grey fill alone read as the pointer resting there. */}
            {choices.map((organization) => (
              <MenuRadioItem
                closeOnClick
                key={organization.membershipId}
                value={organization.membershipId}
                variant="check"
              >
                {organization.name}
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
      {/* The person's own sign-in tokens: Mate deletes each once used; this takes any left over,
          their expired ones too. It keeps the menu open, as Sign out does, to say how it went. */}
      {cleanup === undefined ? null : (
        <MenuItem
          closeOnClick={false}
          data-zerops-account-cleanup={cleanup.state}
          disabled={cleanup.state === "running"}
          onClick={cleanup.onCleanUp}
          variant={cleanup.state === "failed" ? "destructive" : "default"}
        >
          <KeyRoundIcon />
          {signInTokensWords(cleanup.state)}
        </MenuItem>
      )}
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
  // The person's own sign-in tokens, cleaned up as the account's `throwaway-sweep` operation, by
  // the organization it ran for: another organization's menu starts from its first words.
  const operations = useAccountOperationsOptional();
  const [cleaned, setCleaned] = useState<{
    readonly orgId: string;
    readonly state: SignInTokensCleanup;
  } | null>(null);

  if (session === null || session.status !== "signed-in") return null;
  const { user, organizations, activeOrganization, selectOrganization, signOut } = session;
  const orgId = activeOrganization?.id;
  const cleanup =
    operations === null || orgId === undefined
      ? undefined
      : {
          state: cleaned?.orgId === orgId ? cleaned.state : ("idle" as const),
          onCleanUp: () => {
            setCleaned({ orgId, state: "running" });
            void operations
              .submit({ kind: "throwaway-sweep", clientId: orgId, userId: user.id, explicit: true })
              .then(({ progress }) => {
                setCleaned({
                  orgId,
                  state:
                    progress.stage === "done" && progress.outcome === "succeeded"
                      ? "done"
                      : "failed",
                });
              })
              .catch(() => {
                setCleaned({ orgId, state: "failed" });
              });
          },
        };

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarZeropsAccount
      account={zeropsAccountDisplay(user)}
      activeOrganization={activeOrganization}
      cleanup={cleanup}
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
