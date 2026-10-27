// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off preferSchemaOverJson:off -- localhost wire drivers and failure diagnostics.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import type { Page, BrowserContext } from "puppeteer-core";
import { inject } from "vite-plus/test";
import { expect } from "@effect/vitest";
// The policy module alone: the data barrel would put the whole data layer in every scenario's graph.
import { MINIMUM_MATE_SERVER_VERSION } from "../../../../../packages/client-runtime/src/zerops/serverCompatibility.ts";
import { STREAM_POLICY } from "../../../../../packages/client-runtime/src/data/streamMachine.ts";
import { HqAttentionScopeValue } from "@t3tools/shared/hqStream";
import { MateLinkUp, MateOverview } from "@t3tools/shared/mateLink";
import { seedCoreWorld, ticketFor } from "./coreSeed.ts";
import { overviewOf, digest } from "./overviews.ts";
import { definePerson, projectRoles, type PersonOptions } from "../fakes/zeropsWorld.ts";
import { ZeropsFake } from "../fakes/zerops.ts";
import { startGithubFake } from "../fakes/github.ts";
import { MateFake } from "../fakes/mate.ts";
import { hqConnection } from "../fakes/hqConnection.ts";
import { rendered } from "./completedHttp.ts";
import { serve, type HttpHandler } from "./http.ts";
import {
  startScenarioMate,
  type ScenarioMate,
} from "../../../../server/integration/scenarioMate.ts";
import {
  makeScriptedProvider,
  type ScriptedProvider,
} from "../../../../server/integration/scriptedProviderDriver.ts";
import { DataConsoleSpawn } from "../../../../server/src/zerops/ZeropsDataConsole.ts";
import { transportGate } from "./transportGate.ts";
import { answerInZerops, openZeropsWindow } from "./deviceLogin.ts";
import {
  openScenarioNavigation,
  startScenarioCore,
  type HqTimings,
  type ScenarioCore,
} from "./hqCore.ts";
import {
  openBrowser,
  menuMateRow,
  visibleText,
  visibleInMenu,
  sendConversationMessage,
} from "./browser.ts";
import { trackSteps } from "./lastStep.ts";

const decodeOverview = Schema.decodeUnknownEffect(MateOverview);
const encodeLink = Schema.encodeEffect(MateLinkUp);

/** Modules are explicitly installed by their area; no shared registration list to merge. */
export type ScenarioExtension = (drivers: ScenarioDrivers) => void | Promise<void>;
export interface ScenarioDrivers {
  hq: Awaited<ReturnType<typeof hqConnection>>;
  zerops: ZeropsFake;
  /** The GitHub the external Core probes and fetches Git from. */
  github: Awaited<ReturnType<typeof startGithubFake>>;
  mates: Map<string, MateFake>;
  core: ScenarioCore;
  routes: Record<string, string>;
  onMate: ((mate: MateFake) => void)[];
  links: Map<string, Effect.Success<ReturnType<ScenarioDrivers["core"]["socket"]>>>;
  /** The authorization a Mate's HTTP call carries: an external HQ takes its project key. */
  mateAuthorization: (credential: string) => string;
  /** `git clone` arguments for a Mate's checkout of `repo`, at the path and with the authorization its HQ takes (an external HQ qualifies Git paths by organization). */
  mateClone: (credential: string, appId: string, repo: string, dir: string) => string[];
  /**
   * A new link of the enrolled Mate `name` to HQ, the way its container opens one: an external
   * HQ takes the project key in the link's hello; the embedded Core a ticket for `credential`,
   * by default one enrolled anew the way zcp does it.
   */
  linkMate: (
    name: string,
    credential?: string,
  ) => Effect.Effect<
    Effect.Success<ReturnType<ScenarioDrivers["core"]["socket"]>>,
    never,
    Scope.Scope
  >;
  /** The real Mates of a `mate: "real"` scenario, by project. */
  realMates: Map<string, RealMate>;
  owner: string;
  appIds: Map<string, string>;
  cleanup: (() => Promise<void>)[];
}

export interface ScenarioOptions {
  hq?: HqTimings;
  /**
   * Restore an account by default; UI sign-in cases explicitly retain the OAuth journey, and
   * `device-login` signs in through the Zerops window, on the build in `dist`.
   */
  signIn?: "injected" | "ui" | "device-login";
  /** A build to serve instead of the shipped one (`deviceLoginDist`). */
  dist?: string;
  /** `real` starts the real Mate server and engine for each Mate project; the fake stays default. */
  mate?: "fake" | "real";
}

export interface RealMate {
  readonly server: ScenarioMate;
  /** The agent: script its turns, read what it was sent. */
  readonly provider: ScriptedProvider;
  readonly gate: Awaited<ReturnType<typeof transportGate>>;
}

// Calls a Mate makes on its own and survives refused: the model manifest every provider sync
// refreshes (it keeps its bundled copy) and source-control discovery's Bitbucket sign-in probe
// (Bitbucket reads as unavailable).
const decodeAttentionScope = Schema.decodeUnknownSync(HqAttentionScopeValue);

const MATE_SELF_PROBES = new Set([
  "GET https://raw.githubusercontent.com/zeropsio/mate/main/apps/server/src/provider/model-manifest.json",
  "GET https://api.bitbucket.org/2.0/user",
]);

export const createScenario = Effect.fn("scenarios.create")(function* (
  extensions: ScenarioExtension[] = [],
  options: ScenarioOptions = {},
) {
  const cleanup: (() => Promise<void>)[] = [];
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      for (const close of cleanup.toReversed()) await close();
    }),
  );
  const world = seedCoreWorld(yield* Clock.currentTimeMillis, true, "ORG");
  const zerops = new ZeropsFake(world);
  const real = options.mate === "real";
  // A server (a real Mate, HQ) asks the platform what the fake was never taught: the case fails,
  // never guesses. Browser reads carry an Origin and keep the fake path's 404.
  const unmapped: string[] = [];
  const handle: HttpHandler = real
    ? async (request) => {
        const answer = await zerops.handle(request);
        if (answer === undefined && request.headers.origin === undefined)
          unmapped.push(`${request.method} ${request.url.pathname}`);
        return answer;
      }
    : zerops.handle;
  const api = yield* Effect.promise(() => serve(handle, zerops.socket));
  zerops.origin = api.origin;
  cleanup.push(api.close);
  const github = yield* Effect.acquireRelease(Effect.promise(startGithubFake), (github) =>
    Effect.promise(github.close),
  );
  const core = yield* startScenarioCore(
    { baseUrl: `${api.origin}/api/rest/public`, world, github },
    options.hq,
  );
  const personal = core.fake.tokens.get("door-owner")!;
  core.fake.tokens.set("personal", {
    ...personal,
    id: "personal",
    name: "Scenario personal access token",
  });
  zerops.people.set("personal", "owner");
  const owner = yield* core
    .call("POST", "/api/door", {
      body: { accessToken: "personal", orgId: "ORG", orgKey: "hq" },
    })
    .pipe(
      Effect.map((response) => {
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return (response.body as { session: string }).session;
      }),
    );
  const mates = new Map<string, MateFake>();
  const realMates = new Map<string, RealMate>();
  if (real)
    yield* Effect.addFinalizer(() =>
      unmapped.length === 0
        ? Effect.void
        : Effect.die(new Error(`Unmapped platform calls: ${unmapped.join(", ")}`)),
    );
  const appIds = new Map<string, string>();
  const hq = yield* Effect.promise(() => hqConnection(core.origin));
  cleanup.push(hq.close);
  const routes: Record<string, string> = {
    "https://api.app-prg1.zerops.io": api.origin,
    "https://app.zerops.io": api.origin,
    "https://hqzone.prg1-zerops.zone": hq.origin,
  };
  const linkMate = Effect.fn("scenarios.linkMate")(function* (name: string, credential?: string) {
    const link = yield* core.socket("/api/mate/link");
    yield* link.send({
      type: "hello",
      key: `mate-key-${name}`,
      serviceId: `service-${name}`,
      origin: `https://zcp-${name.toLowerCase()}-8080.prg1.zerops.app`,
    });
    return link;
  });
  const mateAuthorization = (credential: string) => `Project ${credential}`;
  const mateClone = (credential: string, appId: string, repo: string, dir: string) => [
    "clone",
    "-c",
    `http.extraHeader=Authorization: Project ${credential}`,
    `${core.origin}/git/ORG/${appId}/${repo}.git`,
    dir,
  ];
  const drivers = {
    hq,
    linkMate,
    mateAuthorization,
    mateClone,
    owner,
    appIds,
    zerops,
    github,
    mates,
    core,
    routes,
    cleanup,
    onMate: [] as ((mate: MateFake) => void)[],
    links: new Map<string, Effect.Success<ReturnType<typeof core.socket>>>(),
    realMates,
  };
  for (const install of extensions)
    yield* Effect.promise(async () => {
      await install(drivers);
    });

  const persons = new Map<string, { token: string }>();
  const person = (name: string, options: PersonOptions = {}) => {
    persons.set(name, definePerson(zerops.world, name, options));
  };
  person("owner", { role: "OWNER" });
  person("dev", { role: "Developer" });
  person("reader", { role: "READ_ONLY" });
  const app = Effect.fn("scenarios.given.app")(function* (name: string) {
    if (appIds.has(name)) return appIds.get(name)!;
    const response = yield* core.call("POST", "/api/apps", { session: owner, body: { name } });
    if (response.status !== 201)
      return yield* Effect.die(new Error(`HQ app creation refused: ${response.status}`));
    const id = (response.body as { id: string }).id;
    appIds.set(name, id);
    return id;
  });
  const putMateService = (name: string) => {
    zerops.put("service-stack", {
      id: `service-${name}`,
      projectId: name,
      clientId: "ORG",
      name: "zcp",
      status: "ACTIVE",
      subdomainAccess: true,
      serviceStackTypeInfo: {
        serviceStackTypeName: "zcp",
        serviceStackTypeVersionName: "zcp@1",
        serviceStackTypeCategory: "USER",
      },
      ports: [{ port: 8080, scheme: "http" }],
    });
    zerops.put("user-data", {
      id: `mate-flag-${name}`,
      clientId: "ORG",
      serviceStackId: `service-${name}`,
      key: "ZCP_MATE_ENABLED",
      content: "1",
    });
    zerops.put("project", {
      id: name,
      name,
      clientId: "ORG",
      status: "ACTIVE",
      tags: [],
      userRoles: projectRoles(zerops.world, name),
    });
  };
  const enroll = Effect.fn("scenarios.given.enroll")(function* (name: string, inApp?: string) {
    const appId = inApp ? yield* app(inApp) : undefined;
    const response = yield* core.call(
      "POST",
      appId ? `/api/apps/${appId}/projects` : "/api/mates",
      {
        session: owner,
        body: appId
          ? { projectId: name, kind: "mate", mate: { face: "face-1" } }
          : { projectId: name, face: "face-1" },
      },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return `mate-key-${name}`;
  });
  const seedProjectKey = (name: string) => {
    const key = `mate-key-${name}`;
    zerops.world.tokens.set(key, {
      id: key,
      name: `Mate ${name}`,
      orgId: "ORG",
      roleCode: "NO_ACCESS",
      canCreateProjects: false,
      canViewFinances: false,
      canEditFinances: false,
      projects: [{ projectId: name, roleCode: "ADMIN" }],
      createdMs: zerops.clock.currentTimeMillis(),
      createdByUser: "owner",
    });
    return key;
  };
  // The real Mate: its own server, engine and database, linked to the scenario's HQ by a
  // project key and reached by the browser through the container's proxy.
  const realMate = Effect.fn("scenarios.given.realMate")(function* (
    name: string,
    options: {
      app?: string;
      registered?: boolean;
      launchEnvironment?: NodeJS.ProcessEnv;
      provider?: Parameters<typeof makeScriptedProvider>[0];
      claudeSignIn?: boolean;
    },
  ) {
    const key = seedProjectKey(name);
    putMateService(name);
    const credential = options.registered === false ? undefined : yield* enroll(name, options.app);
    const provider = yield* makeScriptedProvider(options.provider);
    const publicOrigin = `https://zcp-${name.toLowerCase()}-8080.prg1.zerops.app`;
    const spawnDataConsole = yield* DataConsoleSpawn;
    const server = yield* Effect.promise(() =>
      startScenarioMate({
        projectId: name,
        serviceId: `service-${name}`,
        hostname: "zcp",
        zeropsApiBaseUrl: `${zerops.origin}/api/rest/public`,
        zeropsApiToken: key,
        publicOrigin,
        allowedOrigins: [web.origin],
        ...(credential ? { hq: { origin: core.origin, credential } } : {}),
        now: () => zerops.clock.currentTimeMillis(),
        drivers: [provider.driver],
        ...(spawnDataConsole === undefined ? {} : { spawnDataConsole }),
        ...(options.claudeSignIn ? { claudeSignIn: true } : {}),
        // The real server announces its package version; a scene's Mate is one the client opens.
        launchEnvironment: {
          T3CODE_SERVER_VERSION: MINIMUM_MATE_SERVER_VERSION,
          ...options.launchEnvironment,
        },
      }),
    );
    cleanup.push(server.remove, server.stop);
    const gate = yield* Effect.promise(() => transportGate(() => server.origin));
    cleanup.push(gate.close);
    realMates.set(name, { server, provider, gate });
    routes[publicOrigin] = gate.origin;
    yield* Effect.promise(() => web.setRoutes());
    if (!credential) return;
    // The Mate links itself; consumers read HQ's attention for it, so that is the receipt.
    const attentionTicket = yield* ticketFor(core.call, owner);
    yield* openScenarioNavigation(
      core.origin,
      attentionTicket,
      (message) =>
        (message.type === "scope-reset" || message.type === "scope-values") &&
        message.scope.kind === "attention" &&
        message.scope.projectId === name &&
        message.values.some((entry) => decodeAttentionScope(entry.value).overview != null),
      { kind: "attention", projectId: name },
    ).pipe(Effect.scoped);
    return credential;
  });
  const project = Effect.fn("scenarios.given.project")(function* (
    name: string,
    options: {
      mate?: boolean;
      app?: string;
      kind?: "mate" | "stage" | "production";
      environmentName?: string;
      registered?: boolean;
      launchEnvironment?: NodeJS.ProcessEnv;
      provider?: Parameters<typeof makeScriptedProvider>[0];
      claudeSignIn?: boolean;
    } = {},
  ) {
    const kind = options.kind ?? (options.mate ? "mate" : undefined);
    zerops.put("project", {
      id: name,
      name,
      clientId: "ORG",
      status: "ACTIVE",
      tags: [],
      userRoles: projectRoles(zerops.world, name),
    });
    if (kind !== "mate") {
      if (options.app && kind && options.registered !== false) {
        const appId = yield* app(options.app);
        const response = yield* core.call("POST", `/api/apps/${appId}/projects`, {
          session: owner,
          body: {
            projectId: name,
            kind,
            environment: { name: options.environmentName ?? name.toLowerCase() },
          },
        });
        if (response.status !== 201)
          return yield* Effect.die(
            new Error(
              `HQ environment attach refused: ${response.status} ${JSON.stringify(response.body)}`,
            ),
          );
      }
      return;
    }
    if (real) return yield* realMate(name, options);
    const mate = new MateFake(name, name);
    for (const install of drivers.onMate) install(mate);
    mates.set(name, mate);
    const server = yield* Effect.promise(() => serve(mate.handle, mate.socket));
    cleanup.push(server.close);
    routes[`https://zcp-${name.toLowerCase()}-8080.prg1.zerops.app`] = server.origin;
    yield* Effect.promise(() => web.setRoutes());
    putMateService(name);
    if (options.registered === false) return;
    seedProjectKey(name);
    const credential = yield* enroll(name, options.app);
    const link = yield* linkMate(name, credential);
    drivers.links.set(name, link);
    yield* link.next("state");
    const overview = yield* decodeOverview({
      ...overviewOf(),
      identity: {
        environmentId: mate.descriptor.environmentId,
        serverVersion: "0.16.0",
        update: null,
        runsWithoutSignIn: true,
      },
      threads: { list: [{ ...digest(mate.thread.id), title: mate.thread.title }], omitted: 0 },
      main: {
        ...mate.shellThread(),
        backgroundLiveness: null,
        latestUserMessageAt: null,
        latestUserMessagePreview: null,
        latestMessagePreview: null,
        planProgress: null,
        pendingQuestion: null,
        usagePause: null,
        liveStep: null,
      },
    });
    yield* link.send(yield* encodeLink({ type: "overview", full: true, overview }));
    // Sending is not an application receipt: wait for the overview consumers will actually read.
    const attentionTicket = yield* ticketFor(core.call, owner);
    yield* openScenarioNavigation(
      core.origin,
      attentionTicket,
      (message) =>
        (message.type === "scope-reset" || message.type === "scope-values") &&
        message.scope.kind === "attention" &&
        message.scope.projectId === name &&
        message.values.some((entry) => {
          const value = decodeAttentionScope(entry.value);
          return value.overview?.main?.id === mate.thread.id;
        }),
      { kind: "attention", projectId: name },
    ).pipe(Effect.scoped);
    return credential;
  });

  const dist = options.dist ?? inject("scenarioDist");
  const web = yield* Effect.promise(() => openBrowser(dist, routes, zerops.clock));
  cleanup.push(web.close);
  const actor = (page: Page, initialPerson = "owner") => {
    let selectedPerson = initialPerson;
    let openedMate: MateFake | undefined;
    let signedInDocument: number | undefined;
    const given = {
      org: (name: string) => {
        zerops.orgName = name;
      },
      project,
      app,
      person,
      asPerson: (name: string) => {
        if (signedInDocument !== undefined)
          throw new Error("Choose person before sign-in; use a new context for another account");
        if (!persons.has(name)) throw new Error(`Define person ${name} first`);
        selectedPerson = name;
      },
      signedIn: Effect.promise(async () => {
        const token = persons.get(selectedPerson)!.token;
        web.setPerson(page, token);
        await web.setRoutes();
        const signIn = options.signIn ?? "injected";
        if (signIn === "injected") await web.gotoWithSession(page, token);
        else await page.goto(web.origin);
        try {
          if (signIn === "device-login")
            await answerInZerops(
              await openZeropsWindow(web, zerops, page, "Continue with your Zerops account"),
              "Approve",
            );
          if (signIn === "ui") {
            await page.waitForFunction(
              () =>
                [...document.querySelectorAll<HTMLButtonElement>("button")].some(
                  (button) => button.innerText.trim() === "Continue with your Zerops account",
                ) ||
                [
                  ...document.querySelectorAll<HTMLElement>(
                    '[data-zerops-surface="sidebar-account"]',
                  ),
                ].some((element) => element.getBoundingClientRect().height > 0),
              { polling: "raf" },
            );
            const hasButton = await page.evaluate(() =>
              [...document.querySelectorAll<HTMLButtonElement>("button")].some(
                (button) => button.innerText.trim() === "Continue with your Zerops account",
              ),
            );
            if (hasButton)
              await page.locator("::-p-aria(Continue with your Zerops account)").click();
          }
          await visibleText(page, "sidebar-account-organization", zerops.orgName);
          signedInDocument = await page.evaluate(() => performance.timeOrigin);
        } catch (error) {
          throw new Error(
            `${String(error)}\n${await page.evaluate(() => document.body.innerText)}\nBrowser errors: ${web.errors.join("\n")}\nRequests: ${JSON.stringify([...zerops.requests])}`,
            { cause: error },
          );
        }
      }),
    };
    const when = {
      zerops: {
        colleague: {
          createsProject: (name: string, options: { mate?: boolean; enroll?: boolean } = {}) =>
            project(name, { ...options, registered: options.enroll ?? false }),
        },
      },
      menu: {
        opensMate: (name: string) =>
          Effect.promise(async () => {
            const row = await menuMateRow(page, name);
            await row.click();
            openedMate = mates.get(name);
          }),
      },
      conversation: {
        sends: (message: string) => Effect.promise(() => sendConversationMessage(page, message)),
      },
      hq: {
        socket: {
          drops: Effect.promise(async () => {
            await hq.socketReady();
            hq.drops();
          }),
          returns: Effect.sync(() => hq.returns()),
        },
        colleague: {
          renamesProject: (from: string, name: string) =>
            core
              .call("PATCH", `/api/apps/${appIds.get(from)}`, { session: owner, body: { name } })
              .pipe(
                Effect.tap((response) =>
                  response.status === 200
                    ? Effect.void
                    : Effect.die(new Error(`HQ rename refused: ${response.status}`)),
                ),
              ),
        },
      },
    };
    const then = {
      hq: {
        isUnavailable: Effect.promise(async () => {
          const outage = '[data-zerops-surface="sidebar-hq-outage"]';
          const clock = web.clock(page);
          // A lost link reads as an outage only once its reconnect grace runs out, counted from
          // when the tab noticed the loss. On a scenario clock that time passes only when
          // advanced, so it passes a grace at a time until the tab says so (about 10 s at most).
          // Each look follows a renderer turn, so what the advance changed is drawn.
          for (let look = 0; clock.installed && look < 40; look++) {
            await rendered(page);
            const shown = await page.evaluate(
              (outage) => (document.querySelector(outage)?.getBoundingClientRect().height ?? 0) > 0,
              outage,
            );
            if (shown) return;
            await clock.advance(STREAM_POLICY.reconnectGraceMs);
          }
          await page.waitForSelector(outage, { visible: true });
        }),
      },
      menu: {
        keepsRows: (names: string[]) =>
          Effect.promise(async () => {
            const guard = await page.evaluateHandle((names) => {
              const state = {
                missing: [] as string[],
                observer: undefined as MutationObserver | undefined,
              };
              const check = () => {
                const rows = new Set(
                  [
                    ...document.querySelectorAll<HTMLElement>(
                      '[data-zerops-surface="sidebar-environments"]',
                    ),
                  ].flatMap((element) =>
                    element.innerText
                      .split("\n")
                      .flatMap((line) => line.split(/\s·\s/).map((part) => part.trim())),
                  ),
                );
                for (const name of names)
                  if (!rows.has(name) && !state.missing.includes(name)) state.missing.push(name);
              };
              check();
              state.observer = new MutationObserver(check);
              state.observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
              });
              return state;
            }, names);
            cleanup.push(() => guard.dispose());
            return Effect.promise(async () => {
              const missing = await guard.evaluate((state) => {
                state.observer?.disconnect();
                return state.missing;
              });
              expect(missing, "Menu rows disappeared during HQ outage").toEqual([]);
            });
          }),
        row: (name: string) => ({
          appears: () =>
            Effect.promise(async () => {
              try {
                await visibleInMenu(page, "sidebar-environments", name);
              } catch (error) {
                throw new Error(
                  `Menu row ${name} missing\n${await page.evaluate(() => document.body.innerText)}\n${web.errors.join("\n")}\n${JSON.stringify([...zerops.requests])}\nFrames: ${JSON.stringify([...zerops.framesByKind])}\nSubscriptions: ${JSON.stringify([...zerops.subscriptions.values()].map(({ kind, name, receiver, output, search }) => ({ kind, name, receiver, output, search })))}`,
                  { cause: error },
                );
              }
            }),
        }),
      },
      conversation: {
        appears: Effect.promise(async () => {
          try {
            await page.waitForSelector('[role="textbox"]', { visible: true });
          } catch (error) {
            throw new Error(
              `${await page.evaluate(() => document.body.innerText)}\n${web.errors.join("\n")}\nRequests: ${JSON.stringify([...zerops.requests])}\nMate requests: ${JSON.stringify([...mates.values()].map((mate) => mate.requests.map((r) => r.tag)))}\nReal Mate requests: ${JSON.stringify([...realMates.values()].map(({ gate }) => gate.requests))}`,
              { cause: error },
            );
          }
        }),
        showsMessage: (text: string) =>
          Effect.promise(async () => {
            if (!openedMate && !real) throw new Error("Open a Mate before checking its timeline");
            if (!real) await openedMate!.conversation.waitForMessage(text);
            await page
              .waitForFunction(
                (text, real) =>
                  (() => {
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                    while (walker.nextNode()) {
                      const node = walker.currentNode;
                      const element = node.parentElement;
                      if (
                        node.textContent === text &&
                        element &&
                        !element.closest('[role="textbox"]') &&
                        // A real Mate's reply is read in its timeline, never in the menu's preview.
                        (!real || element.closest("[data-timeline-row-kind]")) &&
                        element.getBoundingClientRect().height > 0
                      )
                        return true;
                    }
                    return false;
                  })(),
                { polling: real ? 100 : "raf" },
                text,
                real,
              )
              .catch(async (error: unknown) => {
                throw new Error(
                  `Timeline never showed ${JSON.stringify(text)} at ${page.url()}:\n${await page.evaluate(() => document.body.innerText)}\n${web.errors.join("\n")}\nReal Mate requests: ${JSON.stringify([...realMates.values()].map(({ gate }) => gate.requests))}`,
                  { cause: error },
                );
              });
          }),
      },
      budget: {
        zerops: {
          requests: (kind: string) => ({
            atMost: (limit: number) =>
              expect(zerops.requestsByKind.get(kind) ?? 0).toBeLessThanOrEqual(limit),
          }),
          registrations: (kind: string) => ({
            atMost: (limit: number) =>
              expect(zerops.registrations.get(kind) ?? 0).toBeLessThanOrEqual(limit),
          }),
        },
      },
      noReload: Effect.promise(async () =>
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(signedInDocument),
      ),
      noExternalNetwork: Effect.sync(() => {
        expect(web.blocked).toEqual([]);
        expect(web.pageErrors, "Uncaught browser errors").toEqual([]);
        expect([...mates.values()].flatMap((mate) => [...mate.unknownMethods])).toEqual([]);
        expect(unmapped, "Platform calls the fake does not answer").toEqual([]);
        expect(
          [...realMates.values()].flatMap(({ server }) =>
            server.refused.filter((call) => !MATE_SELF_PROBES.has(call)),
          ),
          "A real Mate's outbound calls beyond loopback",
        ).toEqual([]);
      }),
    };
    // The domain DSL's `then` is an assertion object, never a Promise callback.
    // oxlint-disable-next-line unicorn/no-thenable
    return { given, when, then, page, clock: web.clock(page) };
  };
  // Reading a step records it, so the tracked DSL is wrapped last, after the spreads below.
  const tracked = <A extends ReturnType<typeof actor>>(built: A): A => ({
    ...built,
    given: trackSteps("given", built.given),
    when: trackSteps("when", built.when),
    then: trackSteps("then", built.then),
  });
  const primary = actor(web.page);
  const newActor = Effect.fn("scenarios.given.browserActor")(function* (
    options: { person?: string; context?: BrowserContext | "new" } = {},
  ) {
    const context =
      options.context === "new" || options.context === undefined
        ? yield* Effect.promise(() => web.newContext())
        : options.context;
    const page = yield* Effect.promise(() => web.newPage(context));
    return tracked(actor(page, options.person ?? "owner"));
  });
  // oxlint-disable-next-line unicorn/no-thenable -- the scenario keeps its `then` step, never awaited.
  return {
    ...tracked({ ...primary, given: { ...primary.given, browserActor: newActor } }),
    drivers,
    web,
    hq,
    owner,
    appIds,
  };
});
