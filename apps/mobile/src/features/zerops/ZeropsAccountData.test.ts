import type { ReactNode } from "react";
import {
  accountReadsAtom,
  makeAccountStore,
  hqMateOverviewAtom,
  mateAttentionAtom,
  canonicalHqNavigation,
  recordedEnvironment,
} from "@t3tools/client-runtime/data";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { CanonicalHqNavigationEnvironment } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";
import { Atom, AtomRegistry } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../../../web/src/test/reactHookHarness";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../../../web/src/test/reactHookHarness");
  return { ...actual, useEffect: reactHookHarness.useEffect, useMemo: reactHookHarness.useMemo };
});

import { seedHqNavigation } from "@t3tools/client-runtime/data/fixtures";
import { ZeropsAccountData } from "./ZeropsAccountData";
import type { ZeropsDataBinding } from "./ZeropsAccountEnvironmentProvider";
import { buildThreadListV2Items } from "../threads/threadListV2";

const environmentPayload = {
  tier: "production",
  name: "Production",
  sources: ["release"],
  order: 1,
  keyHeld: true,
  keyInvalid: false,
  jobs: [],
  can: {},
  release: null,
  birth: null,
} as const;

function mountAccount() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const show = vi.fn();
  const unexpectedObservation = () => {
    throw new Error("This mobile account witness only observes organization demand.");
  };
  const binding = {
    registry,
    accountData: {
      store,
      data: store.data,
      observation: {
        show,
        closed: () => false,
        demandDetail: () => () => {},
        renewHeld: () => {},
        showHq: unexpectedObservation,
        moveOffers: unexpectedObservation,
        handoverCandidates: unexpectedObservation,
        compare: unexpectedObservation,
        seen: unexpectedObservation,
        readDetail: unexpectedObservation,
        revalidate: unexpectedObservation,
        retryDetail: unexpectedObservation,
        rereadListing: unexpectedObservation,
        retry: unexpectedObservation,
        resume: unexpectedObservation,
        stop: unexpectedObservation,
        close: unexpectedObservation,
      },
    },
  } satisfies NonNullable<Parameters<typeof ZeropsAccountData>[0]["binding"]>;
  const render = (activeOrganizationId: string | null) => {
    hooks.beginRender();
    ZeropsAccountData({ binding, activeOrganizationId, children: null });
  };
  const navigation = Atom.make((get) => {
    const reads = get(accountReadsAtom);
    return reads?.orgId == null
      ? null
      : get(reads.data.project(canonicalHqNavigation, reads.orgId)).structure;
  });
  const stop = registry.subscribe(navigation, () => {}, { immediate: true });
  const seed = (orgId: string, rawEnvironments: ReadonlyArray<unknown>) => {
    const environments = Schema.decodeUnknownSync(Schema.Array(CanonicalHqNavigationEnvironment))(
      rawEnvironments,
    );
    seedHqNavigation(store, orgId, {
      structure: {
        ungrouped: [],
        apps: [{ id: `${orgId}-app`, name: "Application", projects: [], environments }],
      },
    });
  };
  return { registry, store, show, render, navigation, seed, stop };
}

beforeEach(() => hooks.reset());

describe("ZeropsAccountData on mobile", () => {
  describe.each(["old HQ", "canonical HQ"])("%s", (version) => {
    it("Mobile reads HQ environment targets without changing runtime connection or thread identities.", () => {
      const account = mountAccount();
      const thread: EnvironmentThreadShell = {
        environmentId: EnvironmentId.make("connection-1"),
        projectId: ProjectId.make("workspace-1"),
        id: ThreadId.make("thread-1"),
        title: "Retained conversation",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
        archivedAt: null,
        session: null,
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
        settledOverride: null,
        settledAt: null,
      };
      const threadList = () =>
        buildThreadListV2Items({
          threads: [thread],
          environmentId: EnvironmentId.make("connection-1"),
          projectRefs: [{ environmentId: thread.environmentId, projectId: thread.projectId }],
          searchQuery: "",
        }).items.map(({ thread: row }) => [row.environmentId, row.projectId, row.id]);
      const expectedThreadIds = [["connection-1", "workspace-1", "thread-1"]];
      expect(threadList()).toEqual(expectedThreadIds);
      account.render("org-1");
      expect(account.registry.get(account.navigation)).toBeNull();
      const environmentId = version === "old HQ" ? "zerops-1" : "hq-environment-1";
      account.seed("org-1", [
        {
          ...environmentPayload,
          declaration: "9007199254740993",
          ...(version === "old HQ"
            ? { projectId: "zerops-1" }
            : { id: environmentId, target: { kind: "zerops", projectId: "zerops-1" } }),
        },
      ]);
      expect(account.registry.get(account.navigation)?.apps[0]?.environments).toEqual([
        expect.objectContaining({
          id: environmentId,
          target: { kind: "zerops", projectId: "zerops-1" },
          jobs: [],
        }),
      ]);
      const join = (projectId: string) =>
        account.registry.get(
          account.store.data.project(recordedEnvironment, {
            orgId: "org-1",
            appId: "org-1-app",
            projectId,
          }),
        );
      expect(join("zerops-1")).toEqual({
        kind: "recorded",
        name: "Production",
        keyed: true,
        declaration: "9007199254740993",
      });
      if (version === "canonical HQ") expect(join(environmentId)).toEqual({ kind: "waiting" });
      account.render("org-2");
      expect(account.registry.get(account.navigation)).toBeNull();
      expect(threadList()).toEqual(expectedThreadIds);
      account.render("org-1");
      expect(account.registry.get(account.navigation)?.apps[0]?.environments).toHaveLength(1);
      expect(threadList()).toEqual(expectedThreadIds);
      expect(account.show.mock.calls).toEqual([["org-1"], ["org-2"], ["org-1"]]);
      account.stop();
      account.registry.dispose();
    });
  });
  it("Mobile retains the Zerops environments when a git environment has no legacy projectId.", () => {
    const account = mountAccount();
    account.render("org-1");
    expect(account.registry.get(account.navigation)).toBeNull();
    const zerops = {
      ...environmentPayload,
      id: "hq-zerops",
      target: { kind: "zerops", projectId: "zerops-project" },
    };
    const git = {
      ...environmentPayload,
      id: "hq-git",
      name: "Git production",
      target: { kind: "git", branch: "production", delivery: "direct" },
    };
    account.seed("org-1", [zerops, git]);
    // Git delivery is read on its own (`deliveryEnvironments`): it is never listed as a project.
    const environments = () => account.registry.get(account.navigation)?.apps[0]?.environments;
    expect(environments()).toEqual([zerops]);
    const heard: Array<string | null | undefined> = [];
    const stop = account.registry.subscribe(accountReadsAtom, (reads) => heard.push(reads?.orgId));
    account.render("org-2");
    expect(account.registry.get(account.navigation)).toBeNull();
    account.seed("org-2", [{ ...environmentPayload, projectId: "other-project" }]);
    expect(environments()).toEqual([
      {
        ...environmentPayload,
        projectId: "other-project",
        id: "other-project",
        target: { kind: "zerops", projectId: "other-project" },
      },
    ]);
    account.render("org-1");
    expect(environments()).toEqual([zerops]);
    expect(heard).toEqual(["org-2", "org-1"]);
    expect(account.registry.get(accountReadsAtom)?.data).toBe(account.store.data);
    account.render(null);
    expect(account.registry.get(account.navigation)).toBeNull();
    expect(account.registry.get(accountReadsAtom)?.orgId).toBeNull();
    stop();
    account.stop();
    account.registry.dispose();
  });
  it("hands the account's reads over to another organization, never leaving them unset between", () => {
    const registry = AtomRegistry.make();
    const binding = {
      registry,
      accountData: {
        data: {},
        observation: {
          show: () => undefined,
          closed: () => false,
          demandDetail: () => () => {},
          renewHeld: () => {},
        },
      },
    } as unknown as ZeropsDataBinding;
    const render = (activeOrganizationId: string) => {
      hooks.beginRender();
      ZeropsAccountData({ binding, activeOrganizationId, children: null });
    };
    render("org-1");
    const heard: Array<string | null | undefined> = [];
    const stop = registry.subscribe(accountReadsAtom, (reads) => heard.push(reads?.orgId));
    render("org-2");
    stop();
    expect(heard).toEqual(["org-2"]);
  });
  it("retained mobile shares org-keyed HQ and attention readers without changing its thread sidebar", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    seedHqNavigation(store, "org-1", {
      mates: { mate: { presence: { online: true, since: "now", overview: "none" } } },
    });
    const binding = {
      registry,
      accountData: {
        store,
        data: store.data,
        observation: {
          show: () => undefined,
          closed: () => false,
          demandDetail: () => () => {},
          renewHeld: () => {},
        },
      },
    } as unknown as ZeropsDataBinding;
    const render = (activeOrganizationId: string) => {
      hooks.beginRender();
      ZeropsAccountData({ binding, activeOrganizationId, children: null });
    };
    render("org-1");
    const row = hqMateOverviewAtom("mate");
    const stop = registry.subscribe(row, () => registry.get(row), { immediate: true });
    expect(registry.get(row)?.presence.online).toBe(true);
    render("org-2");
    expect(registry.get(row)).toBeNull();
    expect(registry.get(mateAttentionAtom("mate"))).toEqual({
      attention: null,
      live: false,
      unseen: null,
    });
    stop();
    registry.dispose();
  });
});

vi.mock("./MateImagesProvider", () => ({
  MateImages: ({ children }: { readonly children: ReactNode }) => children,
}));
vi.mock("./MateEngineHostProvider", () => ({
  MateEngineHost: ({ children }: { readonly children: ReactNode }) => children,
}));
