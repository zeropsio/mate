/**
 * Settings → Zerops: which Zerops account this browser holds, the orgs it can
 * see, and the way out. Signing in happens on the Zerops landing, not here.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { zeropsOrganizationRoleLabel } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function ZeropsSettings() {
  const {
    activeOrganization,
    organizationStatus,
    organizations,
    selectOrganization,
    signOut,
    status,
    user,
  } = useZeropsSession();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <SettingsPageContainer>
      <SettingsSection title="Zerops" id="zerops">
        <SettingsRow
          {...searchableSetting("zerops-account")}
          description={
            status === "signed-in"
              ? "The Zerops account this browser is signed in with."
              : "No Zerops account is signed in on this browser."
          }
          status={user?.email ?? null}
          control={
            status === "signed-in" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={signingOut}
                onClick={() => {
                  setSigningOut(true);
                  setError(null);
                  void signOut()
                    .catch((cause: unknown) => {
                      setError(zeropsErrorMessage(cause));
                    })
                    .finally(() => {
                      setSigningOut(false);
                    });
                }}
              >
                Sign out
              </Button>
            ) : (
              <Button size="sm" variant="outline" render={<Link to="/zerops" />}>
                Open Zerops
              </Button>
            )
          }
        />
        {error ? <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p> : null}
        {organizations.length > 0 ? (
          <SettingsRow
            {...searchableSetting("zerops-organizations")}
            description="Projects and permissions are scoped to this Zerops membership."
            status={
              activeOrganization
                ? zeropsOrganizationRoleLabel(activeOrganization)
                : "Choose an organization to continue"
            }
            control={
              <Select
                value={activeOrganization?.membershipId ?? null}
                onValueChange={(membershipId) => {
                  if (membershipId) void selectOrganization(membershipId);
                }}
              >
                <SelectTrigger
                  aria-label="Active Zerops organization"
                  className="min-w-56"
                  disabled={organizationStatus === "loading"}
                  size="sm"
                >
                  <SelectValue placeholder="Choose organization">
                    {activeOrganization?.name}
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
            }
          />
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
