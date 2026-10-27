// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import {
  makeAccountStore,
  makeMateFeeds,
  mateFeedAsyncAtom,
  mateFeedReadsAtom,
} from "@t3tools/client-runtime/data";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/reactivity";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { CollectionRead } from "../components/CollectionRead";
import { collectionPresentation, useEnvironmentQuery } from "./query";

describe("Decision: one derivation per state; consumers never recompute it; no new domain concepts; mobile stays out (later).", () => {
  it("a retained Mate answer shows its source failure in the collection that consumes it", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const snapshot = { available: true, agents: [] };
    const feeds = makeMateFeeds({
      store,
      wire: {
        open: () =>
          Stream.concat(
            Stream.make({ kind: "session" as const }, { kind: "value" as const, value: snapshot }),
            Stream.fail({
              outcome: "transient" as const,
              message: "Distinctive telemetry source failure.",
              code: "source-detail",
            }),
          ),
      },
    });
    registry.set(mateFeedReadsAtom, { data: store.data, ...feeds });
    const atom = mateFeedAsyncAtom({ family: "mateAgentAuth", environmentId: "mate", input: {} });
    const unmount = registry.mount(atom);
    let unlisten = () => {};
    function Probe() {
      const query = useEnvironmentQuery(atom);
      return (
        <CollectionRead
          presentation={collectionPresentation(
            query,
            (data) => (data.available ? ["retained answer"] : []),
            {
              loading: "Loading...",
              unavailable: "Unavailable.",
            },
          )}
          emptyLabel="Confirmed empty"
        >
          {(items) => <div>{items.join(", ")}</div>}
        </CollectionRead>
      );
    }
    try {
      await new Promise<void>((resolve) => {
        unlisten = registry.subscribe(
          atom,
          (result) => {
            if (result._tag === "Failure") resolve();
          },
          { immediate: true },
        );
      });
      expect(registry.get(atom).read).toMatchObject({
        evidence: {
          coverage: "complete",
          fact: { kind: "known", value: { snapshot } },
          stream: {
            phase: "stale",
            fault: {
              outcome: "transient",
              message: "Distinctive telemetry source failure.",
              code: "source-detail",
            },
          },
        },
      });
      const html = renderToStaticMarkup(
        <RegistryContext.Provider value={registry}>
          <Probe />
        </RegistryContext.Provider>,
      );
      expect(html).toContain("Distinctive telemetry source failure.");
      expect(html).toContain("retained answer");
      expect(html).toContain("Showing last-known data.");
      expect(html).not.toContain("Confirmed empty");
    } finally {
      unlisten();
      unmount();
      feeds.close();
      store.close();
      registry.dispose();
    }
  });
});
