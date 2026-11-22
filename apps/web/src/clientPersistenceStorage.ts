import { ClientSettingsSchema, type ClientSettings } from "@t3tools/contracts";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";
import { accountStorageKey } from "./zerops/accountLifetime";

const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  try {
    return getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
  } catch (error) {
    console.error("Could not read persisted client settings.", error);
    return null;
  }
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema);
}

/**
 * Tells `onChange` when another tab writes the signed-in account's settings (storage events fire
 * only for other tabs' writes; a null key means storage was cleared), so this tab's next write
 * starts from them.
 */
export function subscribeBrowserClientSettingsWrites(onChange: () => void): () => void {
  if (!hasWindow()) {
    return () => undefined;
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === accountStorageKey(CLIENT_SETTINGS_STORAGE_KEY) || event.key === null) {
      onChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}
