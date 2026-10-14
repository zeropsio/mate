import { canonicalHqNavigation } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useProjection } from "~/zerops/ZeropsAccountData";
import { GitProductionRemoval } from "../zerops/GitStopDetail";
import { Link } from "@tanstack/react-router";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const NONE = Atom.make(null);

export function ConnectionsSettings() {
  const orgId = useAccountOrgId();
  const navigation = useProjection(canonicalHqNavigation, orgId, NONE);
  return (
    <SettingsPageContainer>
      <SettingsSection title="Zerops environments">
        <p>Mate uses your Zerops account to connect to projects you can operate.</p>
        <Link to="/zerops">Open your projects</Link>
        {navigation?.structure?.apps.flatMap((app) =>
          app.environments === undefined || "refused" in app.environments
            ? []
            : app.environments
                .filter(
                  (environment) =>
                    environment.tier === "production" && environment.target.kind === "git",
                )
                .map((environment) => (
                  <div key={environment.id}>
                    <h3>
                      {app.name} · {environment.name}
                    </h3>
                    <GitProductionRemoval appId={app.id} environmentId={environment.id} />
                  </div>
                )),
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
