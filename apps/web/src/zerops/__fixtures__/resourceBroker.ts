/**
 * A fake `ZeropsResourceBroker.known` for a single resource kind, used to test
 * `useKnown` consumers without a real runtime: one atom whose mount counts as
 * one acquisition, and whose value the test publishes.
 */
import { Atom } from "effect/unstable/reactivity";

import type {
  ZeropsResourceRequest,
  ZeropsResourceValue,
} from "@t3tools/client-runtime/zerops/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

/** Generic fake resource broker for one resource kind (its value type is derived from `Request`). */
export class FakeResourceBroker<Request extends ZeropsResourceRequest> {
  acquisitions = 0;
  current: Shown<ZeropsResourceValue<Request>> = { state: "reading", sinceMs: 0, attempt: 1 };
  private readonly listeners = new Set<(shown: Shown<ZeropsResourceValue<Request>>) => void>();
  private readonly atom = Atom.make((get): Shown<ZeropsResourceValue<Request>> => {
    this.acquisitions += 1;
    const listener = (shown: Shown<ZeropsResourceValue<Request>>) => get.setSelf(shown);
    this.listeners.add(listener);
    get.addFinalizer(() => this.listeners.delete(listener));
    return this.current;
  });

  publish(shown: Shown<ZeropsResourceValue<Request>>): void {
    this.current = shown;
    for (const listener of this.listeners) listener(shown);
  }

  known = (_request: Request): Atom.Atom<Shown<ZeropsResourceValue<Request>>> => this.atom;
}
