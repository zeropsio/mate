/**
 * A fake `ZeropsCells.known` for a single resource kind, used to test
 * `useKnown` consumers without a real runtime: one atom whose mount counts as
 * one acquisition, and whose value the test publishes.
 */
import { Atom } from "effect/unstable/reactivity";

import type { ZeropsCellRequest, ZeropsCellValue } from "@t3tools/client-runtime/zerops/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

/** A fake of the account's cells for one cell kind (its value type is derived from `Request`). */
export class FakeCells<Request extends ZeropsCellRequest> {
  acquisitions = 0;
  current: Shown<ZeropsCellValue<Request>> = { state: "reading", sinceMs: 0, attempt: 1 };
  private readonly listeners = new Set<(shown: Shown<ZeropsCellValue<Request>>) => void>();
  private readonly atom = Atom.make((get): Shown<ZeropsCellValue<Request>> => {
    this.acquisitions += 1;
    const listener = (shown: Shown<ZeropsCellValue<Request>>) => get.setSelf(shown);
    this.listeners.add(listener);
    get.addFinalizer(() => this.listeners.delete(listener));
    return this.current;
  });

  publish(shown: Shown<ZeropsCellValue<Request>>): void {
    this.current = shown;
    for (const listener of this.listeners) listener(shown);
  }

  known = (_request: Request): Atom.Atom<Shown<ZeropsCellValue<Request>>> => this.atom;
}
