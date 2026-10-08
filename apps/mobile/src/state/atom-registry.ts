import { mateEngineReaderAtom } from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/unstable/reactivity";

import {
  disposeOnFoundationReplace,
  type FoundationHotModule,
} from "../lib/foundation-fast-refresh";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

export const appAtomRegistry = AtomRegistry.make();
// This app reads conversations over V1 only: an engine Mate's writes are refused with the update
// route at once, never retried from the outbox.
appAtomRegistry.set(mateEngineReaderAtom, "none");

disposeOnFoundationReplace(typeof module === "undefined" ? undefined : module.hot, () =>
  appAtomRegistry.dispose(),
);
