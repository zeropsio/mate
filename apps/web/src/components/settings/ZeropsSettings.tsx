/**
 * Settings → Zerops: which Zerops account this browser holds, the orgs it can
 * see, and the way out — and the organization's inner workings the overview
 * does not carry: its HQ, and the person's sign-in tokens. Signing in happens
 * on the Zerops landing, not here.
 *
 * The page's breadcrumb already says "Zerops"; the rows say what they are
 * about — the account, the organization — without repeating it.
 */

import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { useAutoUpdatePolicy } from "~/zerops/useAutoUpdatePolicy";
import { useAccountOperations } from "~/zerops/accountOperations";
import { Switch } from "../ui/switch";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { zeropsOrganizationRoleLabel } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { PersonAvatar } from "../zerops/primitives";
import { ZeropsHqCard } from "../zerops/ZeropsHqCard";
import { zeropsAccountDisplay } from "../zerops/landing/ZeropsAccountControl.logic";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { signInTokensWords, type SignInTokensCleanup } from "./zeropsSettings.logic";

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
  const admin = roleAtLeast(activeOrganization?.roleCode, "ADMIN");
  const { policy, again } = useAutoUpdatePolicy(admin);
  const operations = useAccountOperations();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const account = status === "signed-in" ? zeropsAccountDisplay(user) : null;
  // The person's own sign-in tokens, cleaned up as the account's `throwaway-sweep` operation, by
  // the organization it ran for: another organization's row starts from its first words.
  const [cleaned, setCleaned] = useState<{
    readonly orgId: string;
    readonly state: SignInTokensCleanup;
  } | null>(null);
  const orgId = activeOrganization?.id;
  const cleanup: SignInTokensCleanup =
    cleaned !== null && cleaned.orgId === orgId ? cleaned.state : "idle";
  const cleanUp = () => {
    if (orgId === undefined || user === null) return;
    setCleaned({ orgId, state: "running" });
    void operations
      .submit({ kind: "throwaway-sweep", clientId: orgId, userId: user.id, explicit: true })
      .then(({ progress }) => {
        setCleaned({
          orgId,
          state: progress.stage === "done" && progress.outcome === "succeeded" ? "done" : "failed",
        });
      })
      .catch(() => {
        setCleaned({ orgId, state: "failed" });
      });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="Zerops" id="zerops">
        <SettingsRow
          {...searchableSetting("zerops-account")}
          title="Account"
          description={
            account === null
              ? "No Zerops account is signed in on this browser."
              : "Signed in on this browser."
          }
          status={
            account === null ? null : (
              <span className="flex items-center gap-2" data-zerops-account-line="true">
                <PersonAvatar name={account.name} picture={account.avatarUrl} size={24} />
                <span className="truncate text-foreground">{account.fullName ?? account.name}</span>
                {account.email === null ? null : <span className="truncate">{account.email}</span>}
              </span>
            )
          }
          control={
            account === null ? (
              <Button size="md" variant="outline" render={<Link to="/zerops" />}>
                Open Zerops
              </Button>
            ) : (
              <Button
                size="md"
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
            )
          }
        />
        {error ? <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p> : null}
        {organizations.length > 0 ? (
          <SettingsRow
            {...searchableSetting("zerops-organizations")}
            title="Organization"
            description="Environments and permissions come from the organization you pick."
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
                  aria-label="Active organization"
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
        {activeOrganization ? (
          <SettingsRow
            {...searchableSetting("zerops-auto-update")}
            title="Update Mates automatically"
            description="Updates only when a Mate is idle; rolls back if the new version fails."
            status={
              <>
                <span>{policy.words}</span>
                {!admin ? <span> · Organization admins and the owner can change this.</span> : null}
                {policy.error ? <span role="alert"> · {policy.error}</span> : null}
              </>
            }
            control={
              admin ? (
                <div className="flex items-center gap-2">
                  {policy.retryRead ? (
                    <Button size="md" variant="outline" onClick={again}>
                      Retry read
                    </Button>
                  ) : null}
                  {policy.recoverable && policy.policy.kind === "known" ? (
                    <Button
                      size="md"
                      variant="outline"
                      onClick={() => {
                        if (policy.policy.kind !== "known") return;
                        void operations.submit(
                          {
                            kind: "set-auto-update-policy",
                            orgId: activeOrganization.id,
                            enabled: !policy.policy.enabled,
                          },
                          policy.requestId,
                        );
                      }}
                    >
                      Send new change: {policy.policy.enabled ? "Off" : "On"}
                    </Button>
                  ) : null}
                  {policy.policy.kind !== "known" ? null : (
                    <Switch
                      aria-label="Update Mates automatically"
                      checked={policy.policy.enabled}
                      disabled={!policy.editable}
                      onCheckedChange={(enabled) => {
                        if (!policy.editable) return;
                        void operations.submit(
                          { kind: "set-auto-update-policy", orgId: activeOrganization.id, enabled },
                          policy.requestId,
                        );
                      }}
                    />
                  )}
                </div>
              ) : policy.retryRead ? (
                <Button size="md" variant="outline" onClick={again}>
                  Retry read
                </Button>
              ) : null
            }
          />
        ) : null}
        {activeOrganization && account !== null ? (
          <SettingsRow
            {...searchableSetting("zerops-sign-in-tokens")}
            title="Sign-in tokens"
            description="Each time Mate opens HQ it makes a short-lived Zerops token, and deletes it once used. Clean up any left over, your expired ones included."
            control={
              <Button
                disabled={cleanup === "running"}
                onClick={cleanUp}
                size="md"
                variant="outline"
              >
                {signInTokensWords(cleanup)}
              </Button>
            }
          />
        ) : null}
      </SettingsSection>
      {activeOrganization ? (
        <SettingsSection {...searchableSetting("zerops-hq")} title="HQ">
          <div className="px-3 sm:px-4">
            <ZeropsHqCard />
          </div>
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
