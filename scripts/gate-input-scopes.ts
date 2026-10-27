/**
 * The reviewed source roots scanned by every oxlint-side guard: the client sources, and HQ for the
 * guards that reach it (each rule still decides from a file's path whether it applies).
 */
export const guardScopePaths = [
  "apps/web/src",
  "apps/mobile/src",
  "apps/desktop/src",
  "packages/shared/src",
  "packages/client-runtime/src",
  "apps/hq/src",
] as const;

export const runtimeCycleSourceRoots = [
  "apps/web/src",
  "apps/server/src",
  "apps/hq/src",
  "apps/mobile/src",
  "apps/desktop/src",
  "packages/client-runtime/src",
  "packages/contracts/src",
  "packages/shared/src",
  "packages/hq-git/src",
];

export const retainedTestFile = /(?:\.test\.tsx?|\.scenario\.ts)$/u;
