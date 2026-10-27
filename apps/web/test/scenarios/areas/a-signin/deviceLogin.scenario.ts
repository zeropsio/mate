import { beforeAll, describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { deviceLoginDist } from "../../harness/deviceLoginBundle.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installSignIn, sensitiveSharedValue } from "./fake.ts";
import { account, historyAddresses, vault, zeropsWindow } from "./dsl.ts";

/** The device-login build, once `beforeAll` has it. */
let dist = "";
const deviceLoginScenario = () => createScenario([installSignIn], { signIn: "device-login", dist });

describe("A: sign-in through the Zerops window", () => {
  beforeAll(async () => {
    dist = await deviceLoginDist();
  });
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches an approval in the Zerops window leaving the person at the door, or the window
    // asked without the popup display it closes itself by.
    it.effect("sign-in through Zerops opens the account", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        const consent = yield* zeropsWindow(s).lastConsentPage;
        expect(consent.searchParams.get("display")).toBe("popup");
        expect(consent.searchParams.has("intent")).toBe(false);
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches Sign up losing its intent on the way to Zerops, or a brand-new account landing
    // anywhere but Mate's onboarding for its own, empty organization.
    it.effect("sign-up through Zerops opens the new, empty account into Mate's onboarding", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        const window = zeropsWindow(s);
        yield* Effect.promise(() => s.page.goto(s.web.origin));
        yield* window.answers(yield* window.opens("Create one on Zerops"), "Approve");
        const consent = yield* window.lastConsentPage;
        expect(consent.searchParams.get("intent")).toBe("register");
        expect(consent.searchParams.get("display")).toBe("popup");
        yield* Effect.promise(async () => {
          // A configured HQ starts the owner's organization at sign-in; a discovered HQ
          // still asks its owner to set one up before the first project.
          await s.page.waitForFunction(
            () =>
              document.body.innerText.includes("Set up HQ for Newcomer") ||
              document.querySelector('[data-zerops-surface="first-run"]') !== null,
            { polling: "raf" },
          );
          const configured = s.drivers.core.kind === "external";
          expect(
            await s.page.evaluate(() => document.body.innerText),
            "ASSERTION: sign-up opens the new account's onboarding",
          ).toContain(configured ? "Start a project" : "Set up HQ for Newcomer");
          if (configured) await s.page.locator('::-p-aria(New project[role="button"])').wait();
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
        const window = zeropsWindow(s);
        yield* Effect.promise(() => s.page.goto(s.web.origin));
        yield* window.answers(yield* window.opens("Continue with your Zerops account"), "Deny");
        yield* window.says("Sign-in was cancelled.");
        yield* window.answers(yield* window.opens("Try again"), "Approve");
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a request the platform forgot leaving the landing waiting forever, or Mate closing
    // the window the person is still using (halfway through signing up) when a code lapses.
    it.effect("a Zerops window left past its time says to start again", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* Effect.promise(() => s.clock.install());
        const window = zeropsWindow(s);
        yield* Effect.promise(() => s.page.goto(s.web.origin));
        const opened = yield* window.opens("Continue with your Zerops account");
        yield* window.says("MATE-0001");
        // A request lapses after five minutes: Mate asks for a new code and leaves the window be,
        // saying the window may still show the old one.
        yield* Effect.promise(() => s.clock.advance(6 * 60_000, true));
        yield* window.says("MATE-0002");
        yield* window.says("the code in the Zerops window may have changed");
        expect(opened.isClosed()).toBe(false);
        // Half an hour on, the person has walked away.
        for (let lapse = 0; lapse < 4; lapse++)
          yield* Effect.promise(() => s.clock.advance(6 * 60_000, true));
        yield* window.says("The Zerops window timed out. Start again.");
        expect(opened.isClosed()).toBe(false);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a blocked popup stranding the person: the link opens the consent page itself.
    it.effect("a blocked Zerops window becomes a link that signs in", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        const window = zeropsWindow(s);
        s.web.setPerson(s.page, "personal");
        yield* Effect.promise(() => s.page.goto(s.web.origin));
        yield* window.blocksPopups;
        yield* Effect.promise(() =>
          s.page.locator("::-p-aria(Continue with your Zerops account)").click(),
        );
        const link = yield* Effect.promise(() =>
          s.page
            .locator('::-p-aria(Continue in Zerops[role="link"])')
            .map((anchor) => (anchor as HTMLAnchorElement).href)
            .wait(),
        );
        // A tab, not a popup: nothing to close itself.
        expect(new URL(link).searchParams.has("display")).toBe(false);
        // The person opens the link: a tab of their own browser, signed in to Zerops.
        const tab = yield* Effect.promise(() => s.web.newPage(s.page.browserContext()));
        s.web.setPerson(tab, "personal");
        yield* Effect.promise(() => tab.goto(link));
        yield* Effect.promise(() => tab.locator('::-p-aria(Approve[role="button"])').click());
        yield* Effect.promise(() => s.page.bringToFront());
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches HQ's card asking for a click, a second window, or the request left in an address:
    // HQ approves from its note in the same tab and sends it home, signed in.
    it.effect("opened from HQ's Mate card, Mate signs in with no click, in the same tab", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        s.drivers.zerops.deviceLogin.approvesFromHq = true;
        s.web.setPerson(s.page, "personal");
        yield* Effect.promise(() => s.page.goto(`${s.web.origin}/?signin=hq`));
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        const consent = yield* zeropsWindow(s).lastConsentPage;
        expect(consent.searchParams.get("back")).toBe(`${s.web.origin}/?signin=hq-return`);
        expect(consent.searchParams.has("display")).toBe(false);
        // Mate's own entries hold no sign-in, and no entry holds the poll secret.
        for (const address of yield* historyAddresses(s.page)) {
          expect(address).not.toContain("poll-");
          if (address.startsWith(s.web.origin)) expect(address).not.toMatch(/signin|device-/u);
        }
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a denial at HQ reading as an error, or leaving the tab at HQ.
    it.effect("a sign-in from HQ's card denied on HQ's card returns to the landing as it was", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        s.web.setPerson(s.page, "personal");
        // Opened without HQ's card, the consent page asks.
        yield* Effect.promise(() => s.page.goto(`${s.web.origin}/?signin=hq`));
        yield* Effect.promise(() => s.page.locator('::-p-aria(Deny[role="button"])').click());
        const window = zeropsWindow(s);
        yield* window.says("Continue with your Zerops account");
        const text = yield* Effect.promise(() => s.page.evaluate(() => document.body.innerText));
        expect(text).not.toContain("Sign-in didn't finish");
        expect(new URL(s.page.url()).search).toBe("");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a reload with an expired access token sending the person back to Zerops: the
    // session renews itself with its refresh token, and the old pair is spent.
    it.effect("refresh keeps a reloaded tab signed in", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        const deviceLogin = s.drivers.zerops.deviceLogin;
        const [session] = deviceLogin.sessions;
        const expired = session!.accessToken;
        deviceLogin.expireAccess(expired);
        yield* account(s.page).reload;
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        expect(s.drivers.zerops.requests.get("POST /auth/refresh")).toBe(1);
        expect(session!.accessToken, "The session renewed").not.toBe(expired);
        expect(s.drivers.zerops.requests.get("POST /auth/device-login"), "No second sign-in").toBe(
          1,
        );
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a sign-in or a load renewing a session with hours left: the platform revokes the old
    // access token on every refresh, so the first door, the Zerops reads and the websocket login
    // went out with a revoked token and were refused before they were repeated.
    it.effect("a sign-in and a load of the app renew no session and meet no refusal", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        const refused: string[] = [];
        const doors: number[] = [];
        s.page.on("response", (response) => {
          const { pathname } = new URL(response.url());
          if (response.status() === 401) refused.push(pathname);
          if (pathname === "/api/door" && response.request().method() === "POST")
            doors.push(response.status());
        });
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
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

    // Catches sign-out leaving the session alive at Zerops, or another tab still signed in.
    it.effect("sign-out ends the session at Zerops and signs every tab out", () =>
      Effect.gen(function* () {
        const s = yield* deviceLoginScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        const [session] = s.drivers.zerops.deviceLogin.sessions;
        const b = yield* s.given.browserActor({ context: s.page.browserContext() });
        yield* Effect.promise(() => b.page.goto(s.web.origin));
        yield* account(b.page).showsPerson("owner");
        yield* account(b.page).signOut;
        yield* account(b.page).signedOut;
        yield* Effect.promise(() => s.drivers.zerops.waitForRequest("POST /auth/logout"));
        expect(s.drivers.zerops.deviceLogin.revoked).toEqual([session!.accessToken]);
        yield* Effect.promise(() => s.page.bringToFront());
        yield* account(s.page).signedOut;
        yield* account(s.page).reload;
        yield* account(s.page).signedOut;
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
