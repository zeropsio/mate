import { scenarioSuite } from "../../harness/suite.ts";
import { beforeAll, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { zeropsHqDist } from "../../harness/zeropsHqBundle.ts";
import { createScenario } from "../../harness/scenario.ts";
import { recordStep } from "../../harness/lastStep.ts";
import { signedInAtHq } from "../../harness/zeropsHq.ts";
import { installSignIn, sensitiveSharedValue } from "./fake.ts";
import { account, vault, zeropsWindow } from "./dsl.ts";

/** The `zerops-hq` build, once `beforeAll` has it. */
let dist = "";
/** Mate at an origin that Zerops HQ's bridge refuses, as a preview: it signs in by device login. */
const deviceLoginScenario = () => createScenario([installSignIn], { signIn: "device-login", dist });
type Scenario = Effect.Success<ReturnType<typeof deviceLoginScenario>>;

/** The owner signed in at Zerops HQ in the scenario's browser, as the Zerops window then finds them. */
const atZerops = (s: Scenario) =>
  Effect.promise(() => signedInAtHq(s.drivers.zeropsHq!, s.page, "owner"));

/** Advance the platform's one-second poll only after the person's answer reaches Zerops. */
const signInAfterAnswer = (s: Scenario) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => s.clock.install());
    const answered = s.drivers.zeropsHqAnswered();
    const signIn = yield* Effect.forkChild(s.given.signedIn);
    yield* Effect.promise(() => answered);
    yield* Effect.promise(() => s.clock.advanceStepped(1_000));
    yield* Fiber.join(signIn);
  });

/** Answers in the window that `button` opens, then lets the client's next check run. */
const answerAndCheck = (s: Scenario, button: string, decision: "Approve" | "Deny") =>
  Effect.gen(function* () {
    const window = zeropsWindow(s);
    yield* window.answers(yield* window.opens(button), decision);
    yield* Effect.promise(() => s.clock.advanceStepped(1_000));
  });

describe("A: sign-in through the Zerops window", () => {
  beforeAll(async () => {
    dist = await zeropsHqDist();
  });
  scenarioSuite((it) => {
    // Catches an approval in the Zerops window leaving the person at the door, or the window
    // asked without the popup display it closes itself by.
    it.effect("sign-in through Zerops opens the account", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        // A refresh revokes the old access token, so watch the first door, reads and websocket
        // for refusals before they can be retried.
        recordStep("a sign-in and a load of the app renew no session and meet no refusal");
        const refused: string[] = [];
        const doors: number[] = [];
        s.page.on("response", (response) => {
          const { pathname } = new URL(response.url());
          if (response.status() === 401) refused.push(pathname);
          if (pathname === "/api/door" && response.request().method() === "POST")
            doors.push(response.status());
        });
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* signInAfterAnswer(s);
        const consent = yield* zeropsWindow(s).lastConsentPage;
        expect(consent.searchParams.get("display")).toBe("popup");
        expect(consent.searchParams.get("app")).toBe("mate");
        expect(consent.searchParams.has("intent")).toBe(false);
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.menu.row("Ada").appears();
        yield* account(s.page).reload;
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        expect(s.drivers.zerops.requests.get("POST /auth/refresh") ?? 0).toBe(0);
        expect(refused).toEqual([]);
        expect(doors[0], "The first door answered").toBe(200);
        expect(s.drivers.zerops.sockets.size, "The Zerops websocket opened").toBeGreaterThan(0);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches Sign up losing its intent on the way to Zerops, or a brand-new account landing
    // anywhere but Mate's onboarding for its own, empty organization.
    it.effect("sign-up through Zerops opens the new, empty account into Mate's onboarding", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        s.drivers.zerops.world.organizations.set("NEWORG", { name: "Newcomer" });
        s.given.person("newcomer", { orgId: "NEWORG", role: "OWNER" });
        yield* Effect.promise(() => s.clock.install());
        yield* Effect.promise(() => s.page.goto(s.web.origin));
        const window = yield* zeropsWindow(s).opens("Create one on Zerops");
        // Nobody is signed in to Zerops in this browser: the window signs the newcomer up first.
        yield* Effect.promise(async () => {
          await window.locator("::-p-aria(Sign up as)").fill("newcomer");
          await window.locator('::-p-aria(Sign up[role="button"])').click();
        });
        yield* zeropsWindow(s).answers(window, "Approve");
        const consent = yield* zeropsWindow(s).lastConsentPage;
        expect(consent.searchParams.get("intent")).toBe("register");
        expect(consent.searchParams.get("display")).toBe("popup");
        yield* Effect.promise(() => s.clock.advanceStepped(1_000));
        yield* Effect.promise(async () => {
          // The shared HQ starts the owner's organization at sign-in.
          await s.page.waitForFunction(
            () => document.querySelector('[data-zerops-surface="first-run"]') !== null,
            { polling: "raf" },
          );
          expect(
            await s.page.evaluate(() => document.body.innerText),
            "ASSERTION: sign-up opens the new account's onboarding",
          ).toContain("Start a project");
          await s.page.locator('::-p-aria(New project[role="button"])').wait();
        });
        yield* account(s.page).showsPerson("newcomer");
        yield* account(s.page).showsOrganization("Newcomer");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a denial reading as an error or a hang, or Try again not reaching Zerops again.
    it.effect("a sign-in denied in Zerops says so, and Try again signs in", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* atZerops(s);
        yield* Effect.promise(() => s.clock.install());
        yield* Effect.promise(() => s.page.goto(s.web.origin));
        yield* answerAndCheck(s, "Continue with your Zerops account", "Deny");
        yield* zeropsWindow(s).says("The sign-in was denied in Zerops.");
        yield* answerAndCheck(s, "Try again", "Approve");
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a request the platform let lapse leaving the landing waiting forever.
    // witness: apps/web/src/zerops/zeropsHq.ts | expired: "The Zerops window timed out. Try again.", → expired: "Signing in ended.",
    it.effect("a Zerops window left past its time says to try again", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* atZerops(s);
        yield* Effect.promise(() => s.clock.install());
        const window = zeropsWindow(s);
        yield* Effect.promise(() => s.page.goto(s.web.origin));
        yield* window.opens("Continue with your Zerops account");
        const [request] = s.drivers.zeropsHq!.deviceLogins;
        yield* window.says(request!.userCode);
        // A request lapses after five minutes.
        yield* Effect.promise(() => s.clock.advance(6 * 60_000, true));
        yield* window.says("The Zerops window timed out. Try again.");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a blocked popup stranding the person: the link opens the consent page itself.
    it.effect("a blocked Zerops window becomes a link that signs in", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* atZerops(s);
        const window = zeropsWindow(s);
        yield* Effect.promise(() => s.clock.install());
        yield* Effect.promise(() => s.page.goto(s.web.origin));
        yield* window.blocksPopups;
        const answered = s.drivers.zeropsHqAnswered();
        yield* Effect.promise(() =>
          s.page.locator("::-p-aria(Continue with your Zerops account)").click(),
        );
        const link = yield* Effect.promise(() =>
          s.page
            .locator('::-p-aria(Continue in Zerops[role="link"])')
            .map((anchor) => (anchor as HTMLAnchorElement).href)
            .wait(),
        );
        // The person opens the link: a tab of their own browser, signed in to Zerops.
        const tab = yield* Effect.promise(() => s.web.newPage(s.page.browserContext()));
        yield* Effect.promise(() => tab.goto(link));
        yield* Effect.promise(() => tab.locator('::-p-aria(Approve[role="button"])').click());
        yield* Effect.promise(() => answered);
        yield* Effect.promise(() => s.page.bringToFront());
        yield* Effect.promise(() => s.clock.advanceStepped(1_000));
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches sign-out leaving the session alive at Zerops, or another tab still signed in.
    it.effect("sign-out ends the session at Zerops and signs every tab out", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* signInAfterAnswer(s);
        yield* s.then.menu.row("Shop").appears();
        const issued = s.drivers.zeropsHq!.deviceLogins.length;
        const b = yield* s.given.browserActor({ context: s.page.browserContext() });
        yield* Effect.promise(() => b.page.goto(s.web.origin));
        yield* account(b.page).showsPerson("owner");
        yield* account(b.page).signOut;
        yield* account(b.page).signedOut;
        yield* Effect.promise(() => s.drivers.zerops.waitForRequest("POST /auth/logout"));
        expect(s.drivers.zeropsHq!.revoked).toHaveLength(1);
        yield* Effect.promise(() => s.page.bringToFront());
        yield* account(s.page).signedOut;
        yield* account(s.page).reload;
        yield* account(s.page).signedOut;
        expect(s.drivers.zeropsHq!.deviceLogins, "No sign-in started by itself").toHaveLength(
          issued,
        );
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a session that is not in sudo mode stopping at the refusal: confirming in the
    // Zerops window puts it in sudo, and the secret shows without asking again.
    it.effect("the vault's step-up reveals a secret", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        sensitiveSharedValue(s.drivers, "Ada", "STRIPE_KEY", "sk_scenario_secret");
        yield* s.given.signedIn;
        yield* s.when.menu.opensMate("Ada");
        yield* s.then.conversation.appears;
        yield* vault(s.page).opens;
        yield* vault(s.page).shows("STRIPE_KEY");
        const window = zeropsWindow(s);
        yield* window.says("Zerops wants you to confirm it's you before it shows a secret.");
        yield* window.answers(yield* window.opens("Confirm in Zerops"), "Approve");
        yield* vault(s.page).showsValue("STRIPE_KEY", "sk_scenario_secret");
        expect(s.drivers.zerops.requests.get("POST /auth/device-login/sudo")).toBe(1);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
