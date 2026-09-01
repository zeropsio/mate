import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops";
import * as SecureStore from "expo-secure-store";

/** The Zerops account session stays in the device keychain, never in AsyncStorage. */
export const mobileZeropsStorage: ZeropsStorageAdapter = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};
