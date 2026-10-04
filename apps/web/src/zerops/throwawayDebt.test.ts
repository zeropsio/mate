import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { accountThrowawayDebt } from "./throwawayDebt";

const lifetime = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("./accountLifetime", () => ({ currentAccountId: () => lifetime.userId }));

afterEach(() => vi.unstubAllGlobals());

describe("accountThrowawayDebt", () => {
  it("captures the minting account so cleanup after sign-out never writes into another account", () => {
    const entries = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
          entries.set(key, value);
        },
        removeItem: (key: string) => {
          entries.delete(key);
        },
      },
    });
    const client = { session: { userId: "debt-ada", accessToken: "test" } };
    const ada = accountThrowawayDebt(client);
    ada.owe("org-1", 10);
    client.session = { userId: "debt-bea", accessToken: "test" };
    const bea = accountThrowawayDebt(client);
    expect(bea.failedAt("org-1")).toBeNull();
    ada.owe("org-1", 20);
    expect([...entries.keys()]).toEqual(["mate:account:debt-ada:throwaway-debt.v1"]);
    expect(ada.failedAt("org-1")).toBe(20);
    ada.settle("org-1", 20);
    expect(entries.size).toBe(0);
  });
});
