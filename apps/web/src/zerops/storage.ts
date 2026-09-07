import { accountLocalStorage } from "./accountLifetime";
import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops";

const isSelection = (key: string) => key.startsWith("zerops-mate.zerops-selection.");
const isSession = (key: string) => key.startsWith("zerops-mate.zerops-session.");

/** Identity is shared across tabs. Each tab restores its own organization;
 * the account's last selection is only the initial value for a new tab. */
export const browserZeropsStorage: ZeropsStorageAdapter = {
  async get(key) {
    try {
      if (isSelection(key))
        return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
      return (isSession(key) ? window.localStorage : accountLocalStorage).getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      if (isSelection(key)) window.sessionStorage.setItem(key, value);
      (isSession(key) || isSelection(key) ? window.localStorage : accountLocalStorage).setItem(
        key,
        value,
      );
    } catch {
      /* A storage policy can make this session memory-only. */
    }
  },
  async remove(key) {
    try {
      if (isSelection(key)) window.sessionStorage.removeItem(key);
      (isSession(key) || isSelection(key) ? window.localStorage : accountLocalStorage).removeItem(
        key,
      );
    } catch {
      /* Best effort when site data is blocked. */
    }
  },
};
