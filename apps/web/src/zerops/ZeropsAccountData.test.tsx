/**
 * Signing out closes the account's lifetime, which disposes its atom registry before React draws
 * the signed-out page: the account's data must end first, so no screen's release afterwards
 * writes into a disposed registry.
 */
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { accountReadsAtom } from "@t3tools/client-runtime/data";

import { AppAtomRegistryProvider, appAtomRegistry } from "../rpc/atomRegistry";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { useDetailDemand, ZeropsAccountData } from "./ZeropsAccountData";

const shown = vi.hoisted(() => ({ id: "org-1" }));
vi.mock("./ZeropsSessionProvider", () => {
  // The session's client: its socket login never answers, so the link stays connecting.
  const client = {
    baseUrl: "https://api.example.test",
    exchangeWebSocketToken: () => new Promise(() => {}),
    requestData: () => new Promise(() => {}),
    renewHeldSession: () => new Promise(() => {}),
  };
  return {
    useZeropsSession: () => ({
      client,
      status: "signed-in",
      activeOrganization: { id: shown.id, name: "Org", membershipId: "m-1" },
    }),
  };
});

/** A drawn deploy card's hold on its project's history. */
function DeployCard() {
  useDetailDemand("process", "history", "project-1");
  return null;
}

let tree: ReactTestRenderer | undefined;
const errors: unknown[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  errors.length = 0;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args));
  openAccountLifetime("user-1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  closeAccountLifetime();
});

describe("ZeropsAccountData — signing out", () => {
  it("ends the account's data before its registry goes, so a card's release writes nothing", async () => {
    await act(async () => {
      tree = create(
        createElement(
          AppAtomRegistryProvider,
          null,
          createElement(ZeropsAccountData, null, createElement(DeployCard)),
        ),
      );
    });
    // Sign-out: the lifetime closes (the registry is disposed), then the page unmounts.
    let thrown: unknown = null;
    await act(async () => {
      try {
        closeAccountLifetime();
        tree?.unmount();
      } catch (cause) {
        thrown = cause;
      }
    });
    tree = undefined;
    expect(thrown).toBeNull();
    expect(errors.filter((args) => String(args).includes("Cannot access Atom"))).toEqual([]);
  });
});

describe("ZeropsAccountData — another organization shown", () => {
  it("hands the account's reads over to it, never leaving them unset between", async () => {
    shown.id = "org-1";
    const app = () =>
      createElement(AppAtomRegistryProvider, null, createElement(ZeropsAccountData, null));
    await act(async () => {
      tree = create(app());
    });
    const heard: Array<string | null | undefined> = [];
    const stop = appAtomRegistry.subscribe(accountReadsAtom, (reads) => heard.push(reads?.orgId));
    shown.id = "org-2";
    await act(async () => {
      tree?.update(app());
    });
    stop();
    expect(heard).toEqual(["org-2"]);
    await act(async () => {
      tree?.unmount();
    });
    tree = undefined;
  });
});
