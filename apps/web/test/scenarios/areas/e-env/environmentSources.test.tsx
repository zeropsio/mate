// @effect-diagnostics globalFetch:off -- the test captures and guards its two local transports.
import { describe, it, expect } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { RegistryContext } from "@effect/atom-react";
import {
  accountReadsAtom,
  canonicalAppEnvironments,
  canonicalHqNavigation,
  makeAccountStore,
  makeHqWire,
  makeZeropsWire,
  observeAccount,
  type CanonicalAppEnvironmentsRead,
} from "@t3tools/client-runtime/data";
import { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
} from "@t3tools/client-runtime/zerops/data";
import { makePlatformSignals } from "@t3tools/client-runtime/zerops/knowledge";
import { makeAccountRuntime } from "@t3tools/client-runtime/zerops/account/runtime";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { Window } from "happy-dom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { WebSocket } from "ws";
import { environmentFlowSource } from "./environmentFlowSource.ts";
import { AccountDataContext, AccountStoreContext } from "~/zerops/accountData";
import { accountOperations, AccountOperationsContext } from "~/zerops/accountOperations";
import { openAccountLifetime, closeAccountLifetime } from "~/zerops/accountLifetime";
import { accountHqApi, configuredHq } from "~/zerops/accountHq";
import { holdHqWrites } from "~/zerops/hqWrites";
import { bindAccountEnvironments } from "~/zerops/accountEnvironments";
import { bindAccountFlow } from "~/zerops/accountForge";
import { webEnvironmentPorts } from "~/zerops/environmentPorts";
import { ZeropsDataContext } from "~/zerops/zeropsDataContext";
import { ZeropsSessionContext } from "~/zerops/sessionContext";
import { ZeropsInventoryProvider } from "~/zerops/ZeropsInventoryProvider";
import { ZeropsReleaseReview } from "~/components/zerops/review/ZeropsReleaseReview";
import { ZeropsReleaseRows } from "~/components/zerops/ZeropsReleaseRows";
import { ZeropsStopDetailPage } from "~/components/zerops/ZeropsGroupDetail";
import { ZeropsReviewProvider } from "~/zerops/ZeropsReviewProvider";
import { zeropsSessionAtom } from "~/state/zerops";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  Link: ({ to, ...props }: React.ComponentProps<"a"> & { to: string }) =>
    createElement("a", { href: to, ...props }),
  useNavigate: () => () => {},
}));
import { useProjectFlows } from "~/zerops/projectFlows";
import { useHqAppDetailHold } from "~/zerops/useHqAppDetail";
import { endBuild } from "../../fakes/e-env/builds.ts";

function ReleaseAndRows({ appId }: { readonly appId: string }) {
  const [open, setOpen] = useState(true);
  useHqAppDetailHold([appId]);
  const { flows } = useProjectFlows([appId]);
  return (
    <>
      <ul data-test-release-rows>
        <ZeropsReleaseRows
          groupId={appId}
          releases={flows.get(appId)?.releases ?? []}
          pending={new Set()}
          onRollBack={() => {}}
        />
      </ul>
      {open && (
        <ZeropsReleaseReview
          target={{ kind: "release", groupId: appId }}
          titleId="release"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type Source = Effect.Success<ReturnType<typeof environmentFlowSource>>;

type HqJob = NonNullable<
  NonNullable<CanonicalAppEnvironmentsRead["environments"]>[number]["jobs"]
>[number];

function Stage({ appId }: { readonly appId: string }) {
  useHqAppDetailHold([appId]);
  return <ZeropsStopDetailPage groupId={appId} environmentId="Shop-stage" />;
}

function openEnvironmentUi(source: Source, view: "release" | "stage" = "release") {
  return Effect.gen(function* () {
    const window = new Window({ url: "http://localhost/" });
    for (const name of [
      "window",
      "document",
      "HTMLElement",
      "HTMLInputElement",
      "HTMLTextAreaElement",
      "Element",
      "Node",
      "navigator",
    ] as const)
      vi.stubGlobal(name, window[name]);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const allowed = new Set([source.s.drivers.core.origin, source.s.drivers.zerops.origin]);
    const external: string[] = [];
    const pageErrors: string[] = [];
    window.addEventListener("error", (event) =>
      pageErrors.push("message" in event ? String(event.message) : event.type),
    );
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input.toString() : input.url,
      );
      if (!allowed.has(url.origin)) {
        external.push(url.origin);
        throw new Error("Unexpected external request");
      }
      return nativeFetch(input, init);
    });
    class LocalSocket extends WebSocket {
      constructor(address: string) {
        const url = new URL(address);
        url.protocol = url.protocol === "wss:" ? "https:" : "http:";
        if (!allowed.has(url.origin)) {
          external.push(url.origin);
          throw new Error("Unexpected external socket");
        }
        super(address);
      }
    }
    vi.stubGlobal("WebSocket", LocalSocket);
    vi.stubEnv("VITE_HQ_ORIGIN", source.s.drivers.core.origin);
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const client = new ZeropsApiClient({ baseUrl: source.s.drivers.zerops.origin });
    client.restoreSession({ accessToken: "personal" });
    openAccountLifetime("owner");
    const observation = observeAccount({
      store,
      wire: makeZeropsWire({ client }),
      repairSession: Effect.void,
    });
    const hq = configuredHq();
    const api = accountHqApi(client, "ORG", hq);
    const releaseWriter = holdHqWrites("ORG", api, hq.projectId);
    const viewer = {
      id: "ORG",
      name: "ORG",
      membershipId: "owner",
      roleCode: "OWNER" as const,
      status: "ACTIVE",
    };
    const account = {
      data: store.data,
      orgId: "ORG",
      viewer,
      demandDetail: observation.demandDetail,
      renewHeld: observation.renewHeld,
      readDetail: observation.readDetail,
      revalidate: observation.revalidate,
      retryDetail: observation.retryDetail,
      retry: observation.retry,
      showHq: observation.showHq,
      moveOffers: observation.moveOffers,
      compare: observation.compare,
      logs: null,
    };
    registry.set(accountReadsAtom, account);
    const operations = accountOperations(
      store,
      registry,
      client,
      observation.demandDetail,
      observation.revalidate,
      observation.readDetail,
    );
    const accountRef = {
      apiOrigin: makeZeropsApiOrigin(client.baseUrl),
      accountId: ZeropsAccountId.make("owner"),
    };
    const organizationRef = (id: string) => ({
      kind: "organization" as const,
      account: accountRef,
      organizationId: ZeropsOrganizationId.make(id),
    });
    const data = {
      scope: { account: accountRef, epoch: AccountEpoch.make(1) },
      organizationRef,
      projectRef: (orgId: string, id: string) => ({
        kind: "project" as const,
        organization: organizationRef(orgId),
        projectId: ZeropsProjectId.make(id),
      }),
      signals: makePlatformSignals({
        hidden: () => false,
        online: () => true,
        now: () => ({ wall: 0, mono: 0 }),
        listen: () => () => {},
      }),
    };
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: organizationRef("ORG"),
    });
    const runtime = yield* makeAccountRuntime({
      account: data.scope,
      signals: data.signals,
      atomRegistry: registry,
      environments: webEnvironmentPorts(registry),
      store,
    });
    runtime.environments.setActiveOrganization("ORG");
    const unbindEnvironments = bindAccountEnvironments(runtime.environments);
    const unbindFlow = bindAccountFlow(runtime);
    const session = {
      client,
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: viewer,
    } as never;
    const container = window.document.createElement("div");
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    let releaseMembership = () => {};
    const close = Effect.gen(function* () {
      yield* Effect.promise(() => act(async () => root.unmount()));
      unbindFlow();
      unbindEnvironments();
      yield* runtime.close("account-replaced");
      releaseMembership();
      observation.stop();
      releaseWriter();
      yield* Effect.promise(closeAccountLifetime);
      registry.dispose();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });
    try {
      observation.show("ORG");
      releaseMembership = observation.demandDetail({ family: "organizationUser", ownerId: "ORG" });
      observation.showHq({ orgId: "ORG", wire: makeHqWire(api), ownerId: hq.projectId });
      yield* Effect.promise(() =>
        act(async () =>
          root.render(
            <RegistryContext value={registry}>
              <ZeropsSessionContext value={session}>
                <AccountStoreContext value={store}>
                  <AccountDataContext value={account}>
                    <AccountOperationsContext value={operations}>
                      <ZeropsDataContext value={data}>
                        <ZeropsInventoryProvider>
                          <ZeropsReviewProvider>
                            {view === "release" ? (
                              <ReleaseAndRows appId={source.appId} />
                            ) : (
                              <Stage appId={source.appId} />
                            )}
                          </ZeropsReviewProvider>
                        </ZeropsInventoryProvider>
                      </ZeropsDataContext>
                    </AccountOperationsContext>
                  </AccountDataContext>
                </AccountStoreContext>
              </ZeropsSessionContext>
            </RegistryContext>,
          ),
        ),
      );
      const waitText = (text: string) =>
        new Promise<void>((resolve) => {
          const changed = new window.MutationObserver(check);
          function check() {
            if (container.textContent?.includes(text)) {
              changed.disconnect();
              resolve();
            }
          }
          changed.observe(container, { subtree: true, childList: true, characterData: true });
          check();
        });
      const navigation = store.data.project(canonicalHqNavigation, "ORG");
      const waitDeployOffer = (projectId: string) =>
        new Promise<void>((resolve) => {
          const check = () => {
            const environment = registry
              .get(navigation)
              .structure?.apps.flatMap((app) => app.environments ?? [])
              .find(
                (entry) => entry.target.kind === "zerops" && entry.target.projectId === projectId,
              );
            if (environment?.can?.redeploy?.allow === true) {
              stop();
              resolve();
            }
          };
          const stop = registry.subscribe(navigation, check);
          check();
        });
      const environments = store.data.project(canonicalAppEnvironments, {
        orgId: "ORG",
        appId: source.appId,
      });
      const jobs = (tier: "stage" | "production") =>
        registry.get(environments).environments?.find((env) => env.id === `Shop-${tier}`)?.jobs ??
        [];
      const waitJob = (tier: "stage" | "production", readyJob: (job: HqJob) => boolean) => {
        const findJob = () => jobs(tier).find(readyJob);
        return new Promise<NonNullable<ReturnType<typeof findJob>>>((resolve) => {
          const ready = () => {
            const job = findJob();
            if (job !== undefined) {
              stop();
              resolve(job);
            }
          };
          const stop = registry.subscribe(environments, ready);
          ready();
        });
      };
      const builds = (tier: "stage" | "production") =>
        source.s.drivers.zerops
          .rows("process")
          .filter((row) => row.projectId === `Shop-${tier}` && row.actionName === "stack.build");
      return {
        container,
        waitText,
        waitDeployOffer,
        waitJob,
        jobs,
        builds,
        external,
        pageErrors,
        close,
      };
    } catch (error) {
      yield* close;
      throw error;
    }
  });
}

it.effect("a colleague's release displaces an open local release offer", () =>
  Effect.gen(function* () {
    const source = yield* environmentFlowSource({ stage: false });
    yield* source.merge();
    const ui = yield* Effect.acquireRelease(openEnvironmentUi(source), (opened) => opened.close);
    const { container, waitText, waitJob, jobs, builds, external, pageErrors } = ui;
    yield* Effect.promise(() => waitText("Release v0.1.0"));
    const jobReceipt = waitJob(
      "production",
      (job) => job.state === "building" && job.processId !== null,
    );
    yield* source.release("v0.1.0");
    const job = yield* Effect.promise(() => act(async () => jobReceipt));
    expect(container.querySelector('[data-review-kind="release"] .rv-title')?.textContent).toBe(
      "Releasing v0.1.0 to production",
    );
    expect(builds("production")).toHaveLength(1);
    expect(builds("production")[0]).toMatchObject({ id: job.processId, status: "RUNNING" });
    expect(
      jobs("production")
        .filter((entry) => entry.processId === job.processId)
        .map(({ state, processId }) => ({ state, processId })),
    ).toEqual([{ state: "building", processId: job.processId }]);
    endBuild(source.s.drivers.zerops, job.processId!, "FINISHED");
    yield* Effect.promise(() => waitText("v0.1.0 is live"));
    const close = container.querySelector(
      'button[aria-label="Close"]',
    ) as unknown as HTMLButtonElement | null;
    expect(close).not.toBeNull();
    yield* Effect.promise(() => act(async () => close!.click()));
    yield* Effect.promise(() => waitText("Live"));
    const name = [...container.querySelectorAll('[data-zerops-surface="environment-name"]')].find(
      (element) => element.textContent === "v0.1.0",
    );
    expect(name?.closest("[data-zerops-environment-row]")?.textContent).toContain("Live");
    expect(builds("production")).toHaveLength(1);
    expect(external).toEqual([]);
    expect(pageErrors).toEqual([]);
  }).pipe(Effect.scoped),
);

describe("E: deploy observation and the person's next action", () => {
  it.effect(
    "a pending build names the next action and Run again starts an explicit new operation",
    () =>
      Effect.gen(function* () {
        const source = yield* environmentFlowSource();
        const answerBuilds = source.unansweredBuilds();
        const ui = yield* Effect.acquireRelease(
          openEnvironmentUi(source, "stage"),
          (opened) => opened.close,
        );
        const sha = yield* source.merge();
        yield* Effect.promise(() => ui.waitText("Waiting for Zerops to start the build."));
        yield* Effect.promise(() => ui.waitText("Check it in Zerops, or run it again."));
        const before = ui.jobs("stage").filter((job) => job.sha === sha);
        expect(before).toHaveLength(1);
        answerBuilds();
        yield* Effect.promise(() => act(async () => ui.waitDeployOffer("Shop-stage")));
        const runAgain = [
          ...ui.container.querySelectorAll('[data-zerops-surface="stop-service-job"] button'),
        ].find((button) => button.textContent?.trim() === "Run again") as
          | HTMLButtonElement
          | undefined;
        expect(runAgain).toBeDefined();
        const labelledBy = runAgain!.getAttribute("aria-labelledby");
        const accessibleName = labelledBy
          ? labelledBy
              .split(/\s+/u)
              .map((id) => ui.container.ownerDocument.getElementById(id)?.textContent ?? "")
              .join(" ")
              .trim()
          : (runAgain!.getAttribute("aria-label") ?? runAgain!.textContent?.trim());
        expect(accessibleName).toBe("Run again");
        expect(runAgain!.closest('[aria-hidden="true"], [hidden], [inert]')).toBeNull();
        expect(runAgain!.disabled).toBe(false);
        const successor = ui.waitJob(
          "stage",
          (job) => job.sha === sha && job.id !== before[0]!.id && job.state === "building",
        );
        yield* Effect.promise(() =>
          act(async () => {
            runAgain!.click();
            await successor;
          }),
        );
        const next = yield* Effect.promise(() => successor);
        yield* Effect.promise(() => ui.waitText(`Building ${sha.slice(0, 7)}`));
        const after = ui.jobs("stage").filter((job) => job.sha === sha);
        expect(after).toHaveLength(2);
        expect(after.find((job) => job.id === before[0]!.id)?.state).toBe("superseded");
        expect(next.id).not.toBe(before[0]!.id);
        expect(next.cause).toBe("run_again");
        expect(next.state).toBe("building");
        expect(next.processId).not.toBeNull();
        endBuild(source.s.drivers.zerops, next.processId!, "FINISHED");
        yield* Effect.promise(() => ui.waitText("Deployed"));
      }).pipe(Effect.scoped),
  );
});
