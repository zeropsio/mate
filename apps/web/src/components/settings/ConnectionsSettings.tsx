import { Link } from "@tanstack/react-router";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

export function ConnectionsSettings() {
  return (
    <SettingsPageContainer>
      <SettingsSection title="Zerops environments">
        <p>Mate uses your Zerops account to connect to projects you can operate.</p>
        <Link to="/zerops">Open your projects</Link>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
