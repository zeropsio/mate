/**
 * Packages the desktop main-process bundle must NOT inline.
 *
 * The desktop bundle follows the same policy as the server CLI bundle (see
 * cli-external-packages.ts): everything is inlined except what Node has to
 * load from the real filesystem. Both `apps/desktop/vite.config.ts` and the
 * artifact stage in scripts/build-desktop-artifact.ts derive from this list,
 * so a package that is external is also the only kind of package the staged
 * production install carries. Anything not listed here ships inside
 * `dist-electron/*.cjs` and has no `node_modules` presence at all.
 *
 * Entries are matched as prefixes so platform-specific siblings are covered.
 * The Mate main process carries no native addon today (keychain access goes
 * through Electron's own safeStorage), so the list is empty and the staged
 * install carries nothing but Electron.
 */
export const DESKTOP_RUNTIME_EXTERNAL_PREFIXES: readonly string[] = [];

export function isDesktopRuntimeExternalDependency(id: string): boolean {
  return DESKTOP_RUNTIME_EXTERNAL_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** Select the desktop dependency roots whose runtime closure the stage must install. */
export function selectDesktopRuntimeExternalDependencies(
  dependencies: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([name]) => isDesktopRuntimeExternalDependency(name)),
  );
}
