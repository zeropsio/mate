import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { PersonaTemplatesSettings } from "./PersonaTemplatesSettings";
import { SettingsPageContainer } from "./settingsLayout";

/** Settings › Personas: the organization's persona templates. */
export function PersonasSettings() {
  const { activeOrganization } = useZeropsSession();
  return (
    <SettingsPageContainer>
      {/* Keyed by organization: a draft or a write's state never carries into another one. */}
      {activeOrganization ? <PersonaTemplatesSettings key={activeOrganization.id} /> : null}
    </SettingsPageContainer>
  );
}
