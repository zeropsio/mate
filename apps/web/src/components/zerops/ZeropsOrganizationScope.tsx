/**
 * The organization scope, in its two shapes.
 *
 * Before one is chosen it is a screen of its own (`ZeropsOrganizationChoice`): the person can do
 * nothing else until they pick, so neither the menu nor a bar stands around it — Mate's mark, as on
 * the sign-in, and every membership in one card, the first focused. Once chosen it is a control in
 * the top bar — a fact to glance at and a thing to switch, never a section to read — so the pages
 * under it can spend their room on environments.
 */

import { Building2Icon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import {
  zeropsOrganizationRoleLabel,
  type ZeropsOrganization,
} from "@t3tools/client-runtime/zerops";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button, InlineButton } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { ZeropsLandingShell } from "./landing/ZeropsLandingShell";

/** While the organization chosen last is read back: in the app's frame, a line. */
export function ZeropsOrganizationWait() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner size="md" />
      Restoring your Zerops organization…
    </div>
  );
}

/** The choice, for the signed-in person: what the root draws until they pick. */
export function ZeropsOrganizationChoicePage() {
  const { organizations, selectOrganization, user, signOut } = useZeropsSession();
  return (
    <ZeropsOrganizationChoice
      email={user?.email ?? null}
      organizations={organizations}
      onSelect={(membershipId) => {
        void selectOrganization(membershipId);
      }}
      onSignOut={signOut}
    />
  );
}

/**
 * Every membership as a row in one card, the first focused so Enter takes it; under the card, who is
 * signed in and the way out, for an account that is not the one they meant. With none, what to ask
 * for, and the same way out.
 */
export function ZeropsOrganizationChoice({
  organizations,
  email,
  onSelect,
  onSignOut,
}: {
  readonly organizations: ReadonlyArray<ZeropsOrganization>;
  /** Who is signed in; null where Zerops gave no address. */
  readonly email: string | null;
  readonly onSelect: (membershipId: string) => void;
  readonly onSignOut: () => Promise<void>;
}) {
  const [leaving, setLeaving] = useState<"idle" | "busy" | "failed">("idle");
  const signOut = () => {
    setLeaving("busy");
    // Success unmounts the screen with the session; a failure says so on the same words.
    onSignOut().catch(() => setLeaving("failed"));
  };
  const who = email === null ? "Not the right account?" : `Signed in as ${email}.`;
  const foot = (
    <>
      {who}{" "}
      <InlineButton disabled={leaving === "busy"} onClick={signOut} tone="muted">
        {leaving === "failed" ? "Sign out failed. Try again" : "Sign out"}
      </InlineButton>
    </>
  );

  if (organizations.length === 0) {
    return (
      <ZeropsLandingShell
        description="This account isn't in an active Zerops organization."
        foot={foot}
        title="No organization yet"
      >
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            Ask an organization's owner to invite {email ?? "this account"}, then reload this page.
          </p>
          <Button onClick={() => window.location.reload()} variant="secondary">
            Reload
          </Button>
        </div>
      </ZeropsLandingShell>
    );
  }

  return (
    <ZeropsLandingShell
      description="Your projects and what you may do in them come from the organization you pick. Switch any time from your account menu."
      foot={foot}
      title="Choose an organization"
    >
      <ul aria-label="Your organizations" className="-m-3 space-y-1">
        {organizations.map((organization, index) => (
          <li key={organization.membershipId}>
            <button
              autoFocus={index === 0}
              className="group flex w-full cursor-pointer items-center gap-3.5 rounded-2xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
              data-zerops-organization-choice
              type="button"
              onClick={() => {
                onSelect(organization.membershipId);
              }}
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-base font-semibold text-foreground"
              >
                {organization.name.trim().charAt(0).toLocaleUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-5 font-semibold text-foreground">
                  {organization.name}
                </span>
                <span className="block text-xs leading-4 text-muted-foreground">
                  {zeropsOrganizationRoleLabel(organization)}
                </span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground group-focus-visible:text-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </ZeropsLandingShell>
  );
}

/** The chosen organization, switchable in place. Lives in the top bar. */
export function ZeropsOrganizationSwitcher({
  activeOrganization,
  organizations,
  onSelect,
}: {
  readonly activeOrganization: ZeropsOrganization;
  readonly organizations: ReadonlyArray<ZeropsOrganization>;
  readonly onSelect: (membershipId: string) => void;
}) {
  return (
    <Select
      value={activeOrganization.membershipId}
      onValueChange={(membershipId) => {
        if (membershipId) onSelect(membershipId);
      }}
    >
      <SelectTrigger
        aria-label="Active Zerops organization"
        className="w-auto max-w-72 min-w-0"
        size="sm"
      >
        <Building2Icon className="size-4 shrink-0 text-muted-foreground" />
        <SelectValue>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate">{activeOrganization.name}</span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {zeropsOrganizationRoleLabel(activeOrganization)}
            </span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {organizations.map((organization) => (
          <SelectItem key={organization.membershipId} value={organization.membershipId}>
            <span className="flex min-w-0 items-baseline justify-between gap-4">
              <span className="truncate">{organization.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {zeropsOrganizationRoleLabel(organization)}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
