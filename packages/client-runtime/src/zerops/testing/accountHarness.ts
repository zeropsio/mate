/**
 * The account harness (DESIGN §11.1): one Zerops platform and the browser tabs
 * that use it, for tests of the account's lifecycle across sign-in, tabs,
 * sleep and outages.
 *
 * Pure TypeScript with no React and no DOM globals (DESIGN §7.2 rule 1). Web
 * tests adapt a harness tab to a window of their own; `DeadlineClock` drives
 * Effect code's wall and monotonic time.
 */
import type { ZeropsProject, ZeropsUser } from "../api.ts";
import { makeHarnessBrowser, type HarnessBrowser } from "./browserTabs.ts";
import { makeFakeDatastream, type FakeDatastream } from "./fakeDatastream.ts";
import { makeFakeZeropsRest, type FakeZeropsRest } from "./fakeZeropsRest.ts";

export * from "./browserTabs.ts";
export * from "./deadlineClock.ts";
export * from "./fakeDatastream.ts";
export * from "./fakeMate.ts";
export * from "./fakeZeropsRest.ts";

/**
 * Each source the account reads has its fake here, over one shared platform.
 * A source a later slice needs joins as a field of its own: `FakeGitea` and
 * `FakeBroker` with the Gitea session (0.13). A Mate answers on its own
 * (`makeFakeMate`), so no platform is shared with it.
 */
export interface AccountHarness {
  readonly browser: HarnessBrowser;
  readonly rest: FakeZeropsRest;
  readonly datastream: FakeDatastream;
}

export interface AccountHarnessOptions {
  readonly people: ReadonlyArray<{
    readonly user: ZeropsUser;
    readonly password: string;
    readonly totp?: string;
  }>;
  readonly projects?: ReadonlyArray<ZeropsProject>;
  /**
   * The person whose session is stored before the test starts, the way an
   * older build left it (no owner record). Omitted, every tab starts signed out.
   */
  readonly signedIn?: string;
}

export function makeAccountHarness(options: AccountHarnessOptions): AccountHarness {
  const rest = makeFakeZeropsRest();
  for (const person of options.people) rest.addUser(person);
  for (const project of options.projects ?? []) rest.addProject(project);
  return {
    browser: makeHarnessBrowser(
      options.signedIn === undefined ? {} : { session: rest.issueSession(options.signedIn) },
    ),
    rest,
    datastream: makeFakeDatastream(rest),
  };
}
