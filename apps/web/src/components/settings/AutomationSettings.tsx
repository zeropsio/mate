/**
 * Settings › Automation: what the organization's automated Mates run on and act as, set once for
 * every project — the model key, the GitHub app, the Slack and Discord connections, and the limits
 * on each task. Which sources feed a project's automated Mates is set on that project's page.
 *
 * The Owner and Admins see each part's state and its controls; anyone else sees the GitHub app's
 * state, and that the rest is theirs to set.
 */
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";

import { automatedKeyState } from "~/zerops/automatedMate.logic";
import { useOrgAiKeys } from "~/zerops/useAutomationSettings";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { AutomatedMatesUnsupported, OrganizationKeyView } from "./AutomatedMatesSettings";
import { GithubAppSettings } from "./GithubAppSettings";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { TaskSourcesSettings } from "./TaskSourcesSettings";

const NEBIUS = OPENCODE_KEY_PROVIDERS.find((provider) => provider.id === "nebius");
const ADMINS_ONLY = "Only the organization's Owner and Admins see and change this.";

export function AutomationSettings({ returned = false }: { readonly returned?: boolean }) {
  const { activeOrganization } = useZeropsSession();
  const admin = roleAtLeast(activeOrganization?.roleCode, "ADMIN");
  return (
    <SettingsPageContainer>
      <SettingsSection title="Automation" id="automation">
        {activeOrganization === null ? (
          <p className="px-3 text-sm text-muted-foreground sm:px-4">
            Choose an organization in Settings › Zerops to set up automated Mates.
          </p>
        ) : admin ? (
          <AdminParts returned={returned} />
        ) : (
          <>
            <SettingsRow
              description="Pays for the open models automated Mates run on."
              id={searchableSetting("automation-model-key").id}
              status={ADMINS_ONLY}
              title="Model key"
            />
            <GithubAppSettings admin={false} returned={returned} />
            <SettingsRow
              description="Where people hand automated Mates tasks, and how long each may run."
              status={ADMINS_ONLY}
              title="Slack, Discord and limits per task"
            />
          </>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function AdminParts({ returned }: { readonly returned: boolean }) {
  const { read, setKey, removeKey, again } = useOrgAiKeys(true);
  // An HQ that keeps no organization keys predates automated Mates: one line, nothing to set.
  if (automatedKeyState(read.keys) === "unsupported") return <AutomatedMatesUnsupported />;
  return (
    <>
      {NEBIUS === undefined ? null : (
        <OrganizationKeyView
          onAgain={again}
          onRemove={removeKey}
          onSet={setKey}
          provider={NEBIUS}
          read={read}
        />
      )}
      <GithubAppSettings admin returned={returned} />
      <TaskSourcesSettings />
    </>
  );
}
