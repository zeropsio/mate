import { makeAccountStore, mateEngineHostAtom } from "@t3tools/client-runtime/data";
import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { mountMateEngineHost } from "./mateEngineHost";

const connection = {} as EnvironmentRegistry["Service"];
let ids = 0;
const makeId = () => `id-${(ids += 1)}`;

describe("an account's engine conversations on mobile", () => {
  it("are mounted with the account's store, where the app's thread readers and commands find them", () => {
    const app = AtomRegistry.make();
    const atoms = AtomRegistry.make();
    const store = makeAccountStore(atoms);
    const unmount = mountMateEngineHost({ app, atoms, store, connection, makeId });
    const host = app.get(mateEngineHostAtom);
    expect(host?.store).toBe(store);
    expect(host?.atoms).toBe(atoms);
    unmount();
    expect(app.get(mateEngineHostAtom)).toBeNull();
  });

  it("go with their account, leaving the next account's in place", () => {
    const app = AtomRegistry.make();
    const first = AtomRegistry.make();
    const next = AtomRegistry.make();
    const unmountFirst = mountMateEngineHost({
      app,
      atoms: first,
      store: makeAccountStore(first),
      connection,
      makeId,
    });
    const unmountNext = mountMateEngineHost({
      app,
      atoms: next,
      store: makeAccountStore(next),
      connection,
      makeId,
    });
    unmountFirst();
    expect(app.get(mateEngineHostAtom)?.atoms).toBe(next);
    unmountNext();
    expect(app.get(mateEngineHostAtom)).toBeNull();
  });
});
