/**
 * The reviewed source roots scanned by every oxlint-side guard: the client sources (each rule still
 * decides from a file's path whether it applies).
 */
export const guardScopePaths = [
  "apps/web/src",
  "apps/mobile/src",
  "apps/desktop/src",
  "packages/shared/src",
  "packages/client-runtime/src",
] as const;

export const runtimeCycleSourceRoots = [
  "apps/web/src",
  "apps/server/src",
  "apps/mobile/src",
  "apps/desktop/src",
  "packages/client-runtime/src",
  "packages/contracts/src",
  "packages/shared/src",
];

export const retainedTestFile = /(?:\.test\.tsx?|\.scenario\.ts)$/u;

// Test and scenario code whose time must come from the harness or scenario clock.
export const testClockFile = (path: string): boolean =>
  !path.startsWith(".repos/") &&
  /(?:\.test\.ts|\.scenario\.ts)$|(?:^|\/)test\/scenarios\/.+\.ts$/u.test(path);
export const testClockLedger = "scripts/test-clock-exceptions.json";
