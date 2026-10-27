import { expect, it } from "@effect/vitest";
import * as SecureStore from "expo-secure-store";
import { vi } from "vite-plus/test";

const secureStore = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(secureStore.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    secureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: vi.fn((key: string) => {
    secureStore.delete(key);
    return Promise.resolve();
  }),
}));

import { mobileZeropsStorage } from "./storage";

it("round-trips and removes Zerops session values through SecureStore", async () => {
  secureStore.clear();

  await mobileZeropsStorage.set("session", "credential");
  expect(await mobileZeropsStorage.get("session")).toBe("credential");

  await mobileZeropsStorage.remove("session");
  expect(await mobileZeropsStorage.get("session")).toBeNull();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("session", "credential");
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("session");
});
