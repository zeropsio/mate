import { canonicalHqNavigation } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useProjection } from "~/zerops/ZeropsAccountData";
import { ProductionRemoval } from "../zerops/GitStopDetail";
import { Link } from "@tanstack/react-router";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { sharedEnvironmentRows } from "./ConnectionsSettings.logic";

const NONE = Atom.make(null);

export function ConnectionsSettings() {
  const orgId = useAccountOrgId();
  const navigation = useProjection(canonicalHqNavigation, orgId, NONE);
  return (
    <SettingsPageContainer>
      <SettingsSection title="Zerops environments">
        <p>Mate uses your Zerops account to connect to projects you can operate.</p>
        <Link to="/zerops">Open your projects</Link>
        {/* Nothing listed until HQ's structure is read, as before: an unread one is no empty one. */}
        {navigation?.structure?.apps !== undefined &&
          sharedEnvironmentRows(navigation.structure.apps).map((row) => (
            <div key={row.environmentId}>
              <h3>
                <Link
                  params={{ groupId: row.appId, projectId: row.environmentId }}
                  to="/group/$groupId/$projectId"
                >
                  {row.title}
                </Link>
              </h3>
              {row.tier === "production" ? (
                <ProductionRemoval appId={row.appId} environmentId={row.environmentId} />
              ) : null}
            </div>
          ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
