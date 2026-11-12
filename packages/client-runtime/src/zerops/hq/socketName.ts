/**
 * A new name for an HQ stream socket: 16 random bytes in hex. A module of its own that imports
 * nothing: the web's boot entry names its tab's socket before the HQ client has loaded
 * (`apps/web/src/zerops/tabHqSocketName.ts`), and carries only this of it.
 *
 * @module zerops/hq/socketName
 */
export const freshHqSocketName = (): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
