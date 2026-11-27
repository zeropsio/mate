/** A project's core package and the random source a new name is drawn with. */
export type RandomBytes = (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

/**
 * A Zerops project's core package: `LIGHT` (Lightweight, free) or `SERIOUS` (Serious, paid), which
 * the platform takes as the project's `mode` at birth.
 */
export type ZeropsCorePackage = "LIGHT" | "SERIOUS";
