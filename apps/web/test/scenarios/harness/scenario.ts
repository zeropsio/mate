// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off preferSchemaOverJson:off -- localhost wire drivers and failure diagnostics.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { inject } from "vite-plus/test";
import { expect } from "@effect/vitest";
import { MateLinkUp, MateOverview } from "@t3tools/shared/mateLink";
import {
  startCore,
  sessionFor,
  enrollMate,
  untilHealth,
} from "../../../../hq/test/harness/runningCore.ts";
import { mateInApp } from "../../../../hq/test/harness/mates.ts";
import { overviewOf, digest } from "../../../../hq/test/harness/overviews.ts";
import { ZeropsFake } from "../fakes/zerops.ts";
import { MateFake } from "../fakes/mate.ts";
import { hqConnection } from "../fakes/hqConnection.ts";
import { serve } from "./http.ts";
import { openBrowser, clickText, visibleText } from "./browser.ts";

const decodeOverview = Schema.decodeUnknownEffect(MateOverview);
const encodeLink = Schema.encodeEffect(MateLinkUp);

/** Modules are explicitly installed by their area; no shared registration list to merge. */
export type ScenarioExtension = (drivers: ScenarioDrivers) => void | Promise<void>;
export interface ScenarioDrivers {
  zerops: ZeropsFake;
  mates: Map<string, MateFake>;
  core: Effect.Success<ReturnType<typeof startCore>>;
  routes: Record<string, string>;
  onMate: ((mate: MateFake) => void)[];
  links: Map<string, Effect.Success<ReturnType<ScenarioDrivers["core"]["socket"]>>>;
  cleanup: (() => Promise<void>)[];
}

export const createScenario = Effect.fn("scenarios.create")(function* (
  extensions: ScenarioExtension[] = [],
) {
  const core = yield* startCore(true);
  yield* untilHealth(core.call, "active");
  const personal = core.fake.tokens.get("door-owner")!;
  core.fake.tokens.set("personal", {
    ...personal,
    id: "personal",
    name: "Scenario personal access token",
  });
  // Only test credentials; the anchor still names today's production-shaped public address.
  const owner = yield* sessionFor(core.call, "door-owner");
  const zerops = new ZeropsFake(core.fake);
  const mates = new Map<string, MateFake>();
  const appIds = new Map<string, string>();
  const cleanup: (() => Promise<void>)[] = [];
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      for (const close of cleanup.toReversed()) await close();
    }),
  );
  const api = yield* Effect.promise(() => serve(zerops.handle, zerops.socket));
  cleanup.push(api.close);
  const hq = yield* Effect.promise(() => hqConnection(core.origin));
  cleanup.push(hq.close);
  const routes: Record<string, string> = {
    "https://api.app-prg1.zerops.io": api.origin,
    "https://app.zerops.io": api.origin,
    "https://hqzone.prg1-zerops.zone": hq.origin,
  };
  const drivers = {
    zerops,
    mates,
    core,
    routes,
    cleanup,
    onMate: [] as ((mate: MateFake) => void)[],
    links: new Map<string, Effect.Success<ReturnType<typeof core.socket>>>(),
  };
  for (const install of extensions)
    yield* Effect.promise(async () => {
      await install(drivers);
    });

  const project = Effect.fn("scenarios.given.project")(function* (
    name: string,
    options: { mate?: boolean; app?: string; registered?: boolean } = {},
  ) {
    if (!options.mate) {
      zerops.put("project", { id: name, name, clientId: "ORG", status: "ACTIVE", tags: [] });
      return;
    }
    const mate = new MateFake(name, name);
    for (const install of drivers.onMate) install(mate);
    mates.set(name, mate);
    const server = yield* Effect.promise(() => serve(mate.handle, mate.socket));
    cleanup.push(server.close);
    routes[`https://zcp-${name.toLowerCase()}-8080.prg1.zerops.app`] = server.origin;
    yield* Effect.promise(() => web.setRoutes());
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
    zerops.put("project", { id: name, name, clientId: "ORG", status: "ACTIVE", tags: [] });
    if (options.registered === false) return;
    let credential: string;
    if (options.app) {
      const placed = yield* mateInApp(core.call, core.fake, owner, name, options.app);
      credential = placed.credential;
      appIds.set(options.app, placed.appId);
    } else {
      const created = yield* core.call("POST", "/api/mates", {
        session: owner,
        body: { projectId: name, face: "face-1" },
      });
      expect(created.status).toBe(201);
      credential = yield* enrollMate(core.call, core.fake, name);
    }
    const { ticket } = (yield* core.call("POST", "/api/mate/link-ticket", {
      headers: { authorization: `Mate ${credential}` },
    })).body as { ticket: string };
    const link = yield* core.socket(`/api/mate/link?ticket=${ticket}`);
    drivers.links.set(name, link);
    yield* link.next("state");
    const overview = yield* decodeOverview({
      ...overviewOf(),
      identity: {
        environmentId: mate.descriptor.environmentId,
        serverVersion: "0.14.11",
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
  });

  const web = yield* Effect.promise(() => openBrowser(inject("scenarioDist"), routes));
  cleanup.push(web.close);
  const { page } = web;
  let openedMate: MateFake | undefined;
  let signedInDocument: number | undefined;
  const given = {
    org: (name: string) => {
      zerops.orgName = name;
    },
    project,
    signedIn: Effect.promise(async () => {
      await web.setRoutes();
      await page.goto(web.origin);
      try {
        await page
          .locator("::-p-aria(Continue with your Zerops account)")
          .setTimeout(10_000)
          .click();
        await visibleText(page, "sidebar-account", zerops.orgName);
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
          Effect.andThen(
            Effect.promise(async () => {
              await zerops.waitForRegistration("project");
            }),
            project(name, { ...options, registered: options.enroll ?? false }),
          ),
      },
    },
    menu: {
      opensMate: (name: string) =>
        Effect.promise(async () => {
          await clickText(page, "sidebar-mate", name);
          openedMate = mates.get(name);
        }),
    },
    conversation: {
      sends: (message: string) =>
        Effect.promise(async () => {
          const editor = page.locator('::-p-aria([role="textbox"])');
          await editor.fill(message);
          await page.keyboard.press("Enter");
        }),
    },
    hq: {
      socket: {
        drops: Effect.promise(async () => {
          await hq.ready();
          hq.drops();
          await page.waitForSelector('[data-zerops-surface="sidebar-hq-outage"]', {
            visible: true,
            timeout: 10_000,
          });
        }),
        returns: Effect.sync(() => hq.returns()),
      },
      colleague: {
        renamesProject: (from: string, name: string) =>
          core
            .call("PATCH", `/api/apps/${appIds.get(from)}`, { session: owner, body: { name } })
            .pipe(Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(200)))),
      },
    },
  };
  const then = {
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
                ].flatMap((element) => element.innerText.split("\n").map((line) => line.trim())),
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
        appears: (options: { within?: number } = {}) =>
          Effect.promise(async () => {
            try {
              await visibleText(page, "sidebar-environments", name, options.within);
            } catch (error) {
              throw new Error(
                `Menu row ${name} missing\n${await page.evaluate(() => document.body.innerText)}\n${web.errors.join("\n")}\n${JSON.stringify([...zerops.requests])}\nFrames: ${JSON.stringify([...zerops.framesByKind])}\nSubscriptions: ${JSON.stringify([...zerops.subscriptions.values()])}`,
                { cause: error },
              );
            }
          }),
      }),
    },
    conversation: {
      appears: Effect.promise(async () => {
        try {
          await page.waitForSelector('[role="textbox"]', { visible: true, timeout: 15_000 });
        } catch (error) {
          throw new Error(
            `${await page.evaluate(() => document.body.innerText)}\n${web.errors.join("\n")}\nRequests: ${JSON.stringify([...zerops.requests])}\nMate requests: ${JSON.stringify([...mates.values()].map((mate) => mate.requests.map((r) => r.tag)))}`,
            { cause: error },
          );
        }
      }),
      showsMessage: (text: string) =>
        Effect.promise(async () => {
          if (!openedMate) throw new Error("Open a Mate before checking its timeline");
          await openedMate.waitForMessage(text);
          await page.waitForFunction(
            (text) =>
              (() => {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                while (walker.nextNode()) {
                  const node = walker.currentNode;
                  const element = node.parentElement;
                  if (
                    node.textContent === text &&
                    element &&
                    !element.closest('[role="textbox"]') &&
                    element.getBoundingClientRect().height > 0
                  )
                    return true;
                }
                return false;
              })(),
            { timeout: 8000, polling: "raf" },
            text,
          );
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
      expect([...mates.values()].flatMap((mate) => [...mate.unknownMethods])).toEqual([]);
    }),
  };
  // The domain DSL's `then` is an assertion object, never a Promise callback.
  // oxlint-disable-next-line unicorn/no-thenable
  return { given, when, then, drivers, page, web, hq };
});
