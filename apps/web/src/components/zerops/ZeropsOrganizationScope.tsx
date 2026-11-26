/**
 * The organization scope, in its two shapes.
 *
 * Before one is chosen it is a screen of its own (`ZeropsOrganizationChoice`): the person can do
 * nothing else until they pick, so neither the menu nor a bar stands around it — Mate's mark, as on
 * the sign-in, and every membership in one card, the first focused.
 */

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import {
  zeropsOrganizationRoleLabel,
  type ZeropsOrganization,
} from "@t3tools/client-runtime/zerops";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button, InlineButton } from "../ui/button";
import { LogoTile } from "../ui/logo-tile";
import { Row } from "../ui/row";
import { Spinner } from "../ui/spinner";
import { ZeropsLandingShell } from "./landing/ZeropsLandingShell";
import { Text } from "~/components/ui/text";

/** While the organization chosen last is read back: in the app's frame, a line. */
export function ZeropsOrganizationWait() {
  return (
    <Text className="flex items-center gap-2" render={<div />} variant="description">
      <Spinner size="md" />
      Restoring your Zerops organization…
    </Text>
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
          <Text render={<p />} variant="description">
            Ask an organization's owner to invite {email ?? "this account"}, then reload this page.
          </Text>
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
            <Row
              autoFocus={index === 0}
              data-zerops-organization-choice
              lead={<LogoTile>{organization.name.trim().charAt(0).toLocaleUpperCase()}</LogoTile>}
              line={zeropsOrganizationRoleLabel(organization)}
              meta={<ChevronRightIcon aria-hidden="true" className="size-4" />}
              onClick={() => {
                onSelect(organization.membershipId);
              }}
              pressable
              render={<button type="button" />}
              title={organization.name}
            />
          </li>
        ))}
      </ul>
    </ZeropsLandingShell>
  );
}
