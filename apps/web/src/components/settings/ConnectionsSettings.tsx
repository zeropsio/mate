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
        {/* On a phone its words stand at the heading's edge, in the app's size. */}
        <p className="max-sm:px-3 max-sm:text-sm">
          Mate uses your Zerops account to connect to projects you can operate.
        </p>
        <Link
          className="max-sm:inline-flex max-sm:min-h-10 max-sm:items-center max-sm:px-3 max-sm:text-sm"
          to="/zerops"
        >
          Open your projects
        </Link>
        {/* Nothing listed until HQ's structure is read, as before: an unread one is no empty one. */}
        {navigation?.structure?.apps !== undefined &&
          sharedEnvironmentRows(navigation.structure.apps).map((row) => (
            <div className="max-sm:px-3 max-sm:text-sm" key={row.environmentId}>
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
