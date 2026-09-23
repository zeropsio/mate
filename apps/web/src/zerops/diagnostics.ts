/**
 * The web app's handle on the diagnostics ring (`zerops/diagnostics.ts`).
 *
 * Opt-in per browser: with `localStorage["mate:diagnostics"] === "1"` at boot
 * the recorder starts and `globalThis.__mateDiagnostics` offers
 * `snapshot()` and `clear()` to whoever is measuring — a console, a driver.
 * Without the flag nothing is exposed and nothing is recorded.
 */
import { mateDiagnostics, type MateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";

export const MATE_DIAGNOSTICS_FLAG = "mate:diagnostics";

function readFlag(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(MATE_DIAGNOSTICS_FLAG) === "1";
  } catch {
    // Blocked site data reads as the flag being off.
    return false;
  }
}

export function installMateDiagnostics(
  input: {
    readonly storage: Pick<Storage, "getItem">;
    readonly target: object;
    readonly diagnostics: MateDiagnostics;
  } = {
    // Read inside `readFlag`'s guard: touching `localStorage` itself can throw.
    storage: { getItem: (key) => window.localStorage.getItem(key) },
    target: globalThis,
    diagnostics: mateDiagnostics,
  },
): void {
  if (!readFlag(input.storage)) return;
  input.diagnostics.enable();
  Object.defineProperty(input.target, "__mateDiagnostics", {
    value: Object.freeze({
      snapshot: input.diagnostics.snapshot,
      clear: input.diagnostics.clear,
    }),
    enumerable: false,
    configurable: true,
  });
}
