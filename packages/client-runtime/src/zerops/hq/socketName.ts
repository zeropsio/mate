/**
 * The name of an HQ stream socket: a new one is 16 random bytes in hex, and a tab keeps its name
 * only across a reload. A module of its own that imports nothing: the web's boot entry names its
 * tab's socket before the HQ client has loaded (`apps/web/src/zerops/tabHqSocketName.ts`), and
 * carries only this of it.
 *
 * @module zerops/hq/socketName
 */
export const freshHqSocketName = (): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/**
 * The name of a tab's HQ socket for this page load, which HQ ties a held press to: a reload keeps
 * the name the tab stored, so a press held before it stays held; any other load (a new tab, a
 * duplicated tab, which copies the stored name, a fresh navigation) takes `fresh`. The caller
 * stores what this returns. `navigation` is the load's navigation type, `undefined` when unknown.
 */
export const hqSocketNameForLoad = (
  navigation: string | undefined,
  stored: string | null,
  fresh: string,
): string => (navigation === "reload" && stored !== null && stored !== "" ? stored : fresh);
