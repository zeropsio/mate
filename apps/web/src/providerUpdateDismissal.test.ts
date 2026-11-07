// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { removeLocalStorageItem } from "./hooks/useLocalStorage";
import {
  dismissProviderUpdateNotification,
  isProviderUpdateNotificationDismissed,
  PROVIDER_UPDATE_DISMISSALS_STORAGE_KEY,
} from "./providerUpdateDismissal";
import { closeAccountLifetime, openAccountLifetime } from "./zerops/accountLifetime";

describe("providerUpdateDismissal", () => {
  beforeEach(() => {
    openAccountLifetime("provider-dismissal-test");
    removeLocalStorageItem(PROVIDER_UPDATE_DISMISSALS_STORAGE_KEY);
  });
  afterEach(async () => {
    removeLocalStorageItem(PROVIDER_UPDATE_DISMISSALS_STORAGE_KEY);
    await closeAccountLifetime();
  });

  it("persists provider update dismissals by notification key", () => {
    expect(isProviderUpdateNotificationDismissed("opencode:1.14.33")).toBe(false);

    dismissProviderUpdateNotification("opencode:1.14.33");

    expect(isProviderUpdateNotificationDismissed("opencode:1.14.33")).toBe(true);
    expect(isProviderUpdateNotificationDismissed("opencode:1.14.34")).toBe(false);
  });
});
