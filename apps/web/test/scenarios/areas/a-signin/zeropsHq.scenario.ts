import { scenarioSuite } from "../../harness/suite.ts";
import { beforeAll, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { Page } from "puppeteer-core";
import { zeropsHqDist } from "../../harness/zeropsHqBundle.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installSignIn } from "./fake.ts";
import { account } from "./dsl.ts";

/** The `zerops-hq` build, once `beforeAll` has it. */
let dist = "";
/** Mate at its hosted origin, where Zerops HQ's bridge hands it HQ's session, as in production. */
const zeropsHqScenario = () => createScenario([installSignIn], { signIn: "zerops-hq", dist });

const SIGN_IN_FRAME = 'iframe[title="Sign in with Zerops"]';

/** Zerops HQ's sign-in, in its frame over Mate. */
const hqSignIn = (page: Page) =>
  Effect.promise(async () => {
    const frame = await (await page.waitForSelector(SIGN_IN_FRAME))!.contentFrame();
    await frame.locator("::-p-aria(Sign in as)").wait();
    return frame;
  });

describe("A: sign-in through Zerops HQ's shared session", () => {
  beforeAll(async () => {
    dist = await zeropsHqDist();
  });
  scenarioSuite((it) => {
    // Catches a load that finds nobody signed in leaving the person at the door, a sign-in in HQ's
    // frame never reaching Mate, or a reload asking again for the session HQ already holds.
    // witness: apps/web/src/zerops/ZeropsSessionProvider.tsx | if (status === "signed-out") promptSignIn(); → if (status === "signed-out") void 0;
    it.effect(
      "signed out at Zerops HQ, Mate opens HQ's sign-in over the page, and a reload stays signed in with no click",
      () =>
        Effect.gen(function* () {
          const s = yield* zeropsHqScenario();
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* Effect.promise(() => s.page.goto(s.web.origin));
          const frame = yield* hqSignIn(s.page);
          yield* Effect.promise(async () => {
            await frame.locator("::-p-aria(Sign in as)").fill("owner");
            await frame.locator('::-p-aria(Sign in[role="button"])').click();
          });
          yield* account(s.page).showsPerson("owner");
          yield* s.then.menu.row("Shop").appears();
          expect(yield* Effect.promise(() => s.page.$(SIGN_IN_FRAME))).toBeNull();
          yield* account(s.page).reload;
          yield* account(s.page).showsPerson("owner");
          yield* s.then.menu.row("Shop").appears();
          expect(yield* Effect.promise(() => s.page.$(SIGN_IN_FRAME))).toBeNull();
          expect(s.drivers.zeropsHq!.deviceLogins, "No Zerops window was needed").toEqual([]);
          yield* s.then.noExternalNetwork;
        }),
    );

    // Catches a sign-out that leaves HQ's session alive for the other Zerops apps, or a tab of
    // Mate that keeps the account open after it.
    // witness: apps/web/src/zerops/ZeropsSessionProvider.tsx | if (hq !== null) void hq.signOut().catch(() => undefined); → if (hq !== null) void 0;
    it.effect(
      "a sign-out in Mate ends Zerops HQ's session, and every tab of Mate asks for HQ's sign-in again",
      () =>
        Effect.gen(function* () {
          const s = yield* zeropsHqScenario();
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.signedIn;
          yield* s.then.menu.row("Shop").appears();
          const b = yield* s.given.browserActor({ context: s.page.browserContext() });
          yield* Effect.promise(() => b.page.goto(s.web.origin));
          yield* account(b.page).showsPerson("owner");
          yield* account(b.page).signOut;
          yield* account(b.page).signedOut;
          yield* Effect.promise(() => s.drivers.zerops.waitForRequest("POST /auth/logout"));
          expect(s.drivers.zeropsHq!.revoked).toHaveLength(1);
          yield* Effect.promise(() => s.page.bringToFront());
          yield* hqSignIn(s.page);
          expect(
            yield* Effect.promise(() => s.page.$('[data-zerops-surface="sidebar-account"]')),
          ).toBeNull();
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
