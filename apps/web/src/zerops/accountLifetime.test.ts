import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  accountActionsAllowed,
  accountStorageKey,
  captureAccountLifetime,
  closeAccountLifetime,
  currentAccountId,
  onAccountLifetimeClose,
  openAccountLifetime,
  setAccountActionsAllowed,
} from "./accountLifetime";

afterEach(() => closeAccountLifetime());

describe("verified account lifetime", () => {
  it("never exposes an unowned storage key and invalidates old work even for the same account", () => {
    closeAccountLifetime();
    expect(accountStorageKey("draft")).toBeNull();
    expect(captureAccountLifetime()()).toBe(false);
    openAccountLifetime("user-a");
    const alive = captureAccountLifetime();
    const key = accountStorageKey("draft");
    closeAccountLifetime();
    openAccountLifetime("user-a");
    expect(alive()).toBe(false);
    expect(accountStorageKey("draft")).toBe(key);
    openAccountLifetime("user-b");
    expect(accountStorageKey("draft")).not.toBe(key);
  });

  it("flushes original account keys, invalidates async work first, and finishes every cleanup", () => {
    openAccountLifetime("user-a");
    const alive = captureAccountLifetime();
    const flushed: Array<string | null> = [];
    const removeWriter = onAccountLifetimeClose(() => {
      expect(alive()).toBe(false);
      flushed.push(accountStorageKey("draft"));
    });
    const removeBroken = onAccountLifetimeClose(() => {
      throw new Error("storage unavailable");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      closeAccountLifetime();
      expect(flushed).toEqual(["mate:account:user-a:draft"]);
      expect(currentAccountId()).toBeNull();
    } finally {
      removeWriter();
      removeBroken();
      log.mockRestore();
    }
  });

  it("closes write admission at the independent verification deadline", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(100);
      openAccountLifetime("user-a");
      expect(accountActionsAllowed()).toBe(false);
      setAccountActionsAllowed(true, 200);
      expect(accountActionsAllowed()).toBe(true);
      vi.setSystemTime(200);
      expect(accountActionsAllowed()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
