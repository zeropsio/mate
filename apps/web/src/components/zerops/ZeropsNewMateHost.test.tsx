// @vitest-environment happy-dom
import { creationPressStoreAtom, makeAccountStore } from "@t3tools/client-runtime/data";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, createElement as h, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "~/zerops/accountLifetime";
import { beginPress, forgetPress } from "~/zerops/matePress";
import { useMateHandOver, useNewMateDialog } from "~/zerops/newMate";

import { ZeropsNewMateHost } from "./ZeropsNewMateHost";
import { appAtomRegistry, AppAtomRegistryProvider } from "~/rpc/atomRegistry";

const ORGANIZATION = { id: "org-acme", name: "acme", roleCode: "OWNER" };

/** The dialog as the host draws it: its props, read. */
const app = vi.hoisted(() => ({
  dialog: undefined as Record<string, unknown> | undefined,
  holders: new Map<string, number>(),
}));

function useHeldResource(key: string | null) {
  useEffect(() => {
    if (key === null) return;
    app.holders.set(key, (app.holders.get(key) ?? 0) + 1);
    return () => {
      const left = (app.holders.get(key) ?? 1) - 1;
      if (left === 0) app.holders.delete(key);
      else app.holders.set(key, left);
    };
  }, [key]);
}

function useHeldConversation(ref: ScopedThreadRef | null) {
  useHeldResource(ref === null ? null : `conversation:${ref.environmentId}/${ref.threadId}`);
}

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => async () => undefined,
  useRouter: () => ({ routesById: {}, loadRouteChunk: () => undefined }),
}));
vi.mock("~/state/entities", () => ({
  useThreadDetail: (ref: ScopedThreadRef | null) => useHeldConversation(ref),
  useThreadStatus: (ref: ScopedThreadRef | null) => useHeldConversation(ref),
}));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ status: "signed-in", activeOrganization: ORGANIZATION }),
  // No role remembered from the session: the offers read the membership alone.
  useZeropsSessionOptional: () => null,
}));
vi.mock("~/zerops/useEnvironmentCreation", () => ({ useEnvironmentCreation: () => vi.fn() }));
// The account's operations: the creation's steps run there once Add is pressed.
vi.mock("~/zerops/accountOperations", async (actual) => ({
  ...(await actual<typeof import("~/zerops/accountOperations")>()),
  useAccountOperations: () => ({}),
}));
vi.mock("~/zerops/useZeropsCandidates", () => ({
  useZeropsCandidates: () => ({ listing: { state: "unread", waitingFor: null } }),
  useTakenBotNames: () => ({ names: [], complete: true }),
}));
vi.mock("~/zerops/useZeropsRegistry", () => ({
  useZeropsRegistry: () => ({ registry: undefined, loading: false }),
  registryGroupSlug: () => undefined,
}));
vi.mock("~/zerops/projectFlows", () => ({
  useAppsChanges: () => ({ hqAddress: undefined, changes: new Map() }),
  useMateNames: () => new Map(),
}));
vi.mock("~/zerops/useZeropsGroupRecipe", () => ({
  useZeropsGroupRecipe: () => ({
    state: "absent",
    tier: undefined,
    services: [],
    loading: false,
    rereading: false,
    reread: () => undefined,
  }),
}));
vi.mock("~/zerops/useOpenMate", () => ({ useOpenMate: () => () => undefined }));
vi.mock("~/zerops/useZeropsFeeds", () => ({
  useZeropsAgentAuth: (environmentId: EnvironmentId | null) =>
    useHeldResource(environmentId === null ? null : `auth:${environmentId}`),
  useEnvironmentProjectRef: () => null,
}));
vi.mock("./ZeropsEnvironmentCreationDialog", () => ({
  ZeropsEnvironmentCreationDialog: (props: Record<string, unknown>) => {
    app.dialog = props;
    return null;
  },
}));

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  openAccountLifetime("u-ada");
  appAtomRegistry.set(creationPressStoreAtom, makeAccountStore(appAtomRegistry));
  app.dialog = undefined;
  app.holders.clear();
  // Acme CRM, as the menu draws it: its first Mate on its way.
  beginPress({
    projectId: "p-vera",
    organizationId: ORGANIZATION.id,
    startedAt: 0,
    placement: {
      groupId: "g-acme",
      groupName: "Acme CRM",
      kind: "mate",
      displayName: "Vera",
    },
    container: true,
  });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  forgetPress("p-vera");
  appAtomRegistry.get(creationPressStoreAtom)?.close();
  appAtomRegistry.set(creationPressStoreAtom, null);
  useNewMateDialog.setState({ asked: null });
  useMateHandOver.setState({ handOver: null });
  closeAccountLifetime();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("A new Mate's demand handover", () => {
  const conversation: ScopedThreadRef = {
    environmentId: EnvironmentId.make("env-new-mate"),
    threadId: ThreadId.make("thread-first"),
  };
  const held = () => Object.fromEntries(app.holders);
  const expectedHolders = {
    "conversation:env-new-mate/thread-first": 2,
    "auth:env-new-mate": 1,
  };

  const begin = () => {
    act(() => useMateHandOver.getState().handingOver(conversation));
    act(() => {
      tree = create(h(AppAtomRegistryProvider, null, h(ZeropsNewMateHost)));
    });
    expect(held()).toEqual(expectedHolders);
  };

  it("Opening a newly created Mate keeps its source demand until that destination has acquired the same Mate and conversation.", async () => {
    vi.useFakeTimers();
    begin();
    await act(async () => vi.advanceTimersByTimeAsync(3_001));
    expect(useMateHandOver.getState().handOver).toEqual(conversation);
    expect(held()).toEqual(expectedHolders);
  });

  it("A stale or cancelled destination does not release another handover's source demand.", async () => {
    vi.useFakeTimers();
    begin();
    await act(async () => vi.advanceTimersByTimeAsync(2_999));
    act(() => useMateHandOver.getState().handingOver({ ...conversation }));
    await act(async () => vi.advanceTimersByTimeAsync(2));
    expect(useMateHandOver.getState().handOver).toEqual(conversation);
    expect(held()).toEqual(expectedHolders);
  });
});

const open = (again?: Parameters<ReturnType<typeof useNewMateDialog.getState>["ask"]>[1]) => {
  act(() => useNewMateDialog.getState().ask("g-acme", again));
  act(() => {
    tree = create(h(AppAtomRegistryProvider, null, h(ZeropsNewMateHost)));
  });
  return app.dialog!;
};

describe("Add a Mate's dialog, from its host", () => {
  // Run 6's reviews: Start over reopens Add over its project with what it asked for, to change.
  // D3: the name it was asked with is its project's too, whole.
  it("reads an Add started over into the dialog: its name, its project's too, and its face", () => {
    const dialog = open({ botName: "Ida", tint: "rose", shape: "seal" });
    expect(dialog.defaultName).toBe("Ida");
    expect((dialog.defaultTintFor as (name: string) => string)("Ida")).toBe("rose");
    expect((dialog.defaultShapeFor as (name: string) => string | undefined)("Ida")).toBe("seal");
    // Renamed, the face is the new name's own.
    expect(
      (dialog.defaultShapeFor as (name: string) => string | undefined)("Otto"),
    ).toBeUndefined();
  });

  // The roll is the pool's first name when every random byte is zero: a fixed roll, so a test
  // never draws the name another one asserts against (CI drew "Ida" once).
  it("asks for a fresh one where nothing was started over", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((bytes) => {
      if (bytes instanceof Uint8Array) bytes.fill(0);
      return bytes;
    });
    const dialog = open();
    expect(dialog.defaultName).toBe("Abel");
    expect(
      (dialog.defaultShapeFor as (name: string) => string | undefined)("Abel"),
    ).toBeUndefined();
  });

  // Run 6's second review: Add lands on the new Mate's page; the focus never goes back to the +.
  it("lands elsewhere: the focus never goes back to what opened it", () => {
    expect(open().landsElsewhere).toBe(true);
  });
});
