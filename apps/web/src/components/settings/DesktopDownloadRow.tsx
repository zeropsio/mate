import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { SettingsRow } from "./settingsLayout";

const DESKTOP_RELEASES_URL = "https://github.com/zeropsio/mate/releases/latest";

/**
 * Links to the latest desktop app release. The hosted web client is where a
 * user lands first, so it is where "get the desktop app" belongs — but only
 * in a browser tab; inside the Electron shell itself the link is noise.
 */
export function DesktopDownloadRow() {
  return isElectron ? null : <DesktopDownloadRowContent />;
}

function DesktopDownloadRowContent() {
  return (
    <SettingsRow
      title="Desktop app"
      description="The same client in its own window, with the in-app preview browser and your credentials in the system keychain."
      control={
        <Button
          render={<a href={DESKTOP_RELEASES_URL} rel="noreferrer" target="_blank" />}
          size="xs"
          variant="outline"
        >
          Download
        </Button>
      }
    />
  );
}
