/**
 * The account harness (DESIGN §11.1): one Zerops platform and the browser tabs
 * that use it, for tests of the account's lifecycle across sign-in, tabs,
 * sleep and outages.
 *
 * Pure TypeScript with no React and no DOM globals (DESIGN §7.2 rule 1). Web
 * tests adapt a harness tab to a window of their own; `DeadlineClock` drives
 * Effect code's wall and monotonic time.
 */
export * from "./accountRoster.ts";
export * from "./browserTabs.ts";
export * from "./deadlineClock.ts";
export * from "./fakeMate.ts";
export * from "./fakeZeropsRest.ts";
