import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { afterEach, expect, it } from "vite-plus/test";
import { mountHqNavigation } from "./__fixtures__/hqNavigation";
import { useMateCrew } from "./crew/useCrew";
import { hqMatesAtom } from "../state/zerops";
import { mateActivityAtom, matesMenuActivityAtom } from "./mateActivityAtoms";

const AT = "2026-10-07T00:00:00Z";
const decodeMate = Schema.decodeSync(MateLiveView);
const mate = (id: string, text: string, updatedAt = AT) =>
  decodeMate({
    presence: { online: true, since: AT, overview: "live" },
    identity: { environmentId: `env-${id}`, serverVersion: "0.14.35", update: null },
    main: {
      id: `thread-${id}`,
      title: "Task",
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
      interactionMode: "default",
      backgroundLiveness: null,
      session: null,
      latestTurn: null,
      latestUserMessageAt: null,
      updatedAt,
      latestMessagePreview: { role: "assistant", text },
      latestUserMessagePreview: null,
      planProgress: null,
      pendingQuestion: null,
      usagePause: null,
      liveStep: null,
    },
  });
const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
});

it("counts row and tree renders for one message, timestamp-only delivery, unchanged revision and status", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const registry = AtomRegistry.make();
  const ids = Array.from({ length: 30 }, (_, i) => `mate-${i}`);
  let mates = Object.fromEntries(ids.map((id) => [id, mate(id, "First")]));
  const hq = mountHqNavigation(registry, "org", { mates });
  const counts = { aggregateRows: 0, keyedRows: 0, tree: 0 };
  function BeforeRow({ id }: { readonly id: string }) {
    useAtomValue(hqMatesAtom)?.mates.get(id);
    counts.aggregateRows++;
    return null;
  }
  function Row({ id }: { readonly id: string }) {
    useAtomValue(mateActivityAtom(id));
    useMateCrew(id);
    counts.keyedRows++;
    return null;
  }
  function Tree() {
    useAtomValue(matesMenuActivityAtom);
    counts.tree++;
    return null;
  }
  act(() => {
    mounted.push(
      create(
        <RegistryContext.Provider value={registry}>
          <Tree />
          {ids.map((id) => (
            <BeforeRow key={`before-${id}`} id={id} />
          ))}
          {ids.map((id) => (
            <Row key={id} id={id} />
          ))}
        </RegistryContext.Provider>,
      ),
    );
  });
  const reset = () => {
    counts.aggregateRows = 0;
    counts.keyedRows = 0;
    counts.tree = 0;
  };
  const deliver = (next: MateLiveView) => {
    mates = { ...mates, [ids[0]!]: next };
    act(() => hq.seed({ mates }));
  };
  reset();
  deliver(mate(ids[0]!, "Second"));
  expect(counts).toEqual({ aggregateRows: 30, keyedRows: 1, tree: 0 });
  reset();
  deliver(mate(ids[0]!, "Second", "2026-10-07T00:00:01Z"));
  expect(counts).toEqual({ aggregateRows: 30, keyedRows: 0, tree: 0 });
  reset();
  deliver(structuredClone(mates[ids[0]!]!));
  expect(counts).toEqual({ aggregateRows: 0, keyedRows: 0, tree: 0 });
  reset();
  deliver(mate(ids[0]!, "Third", "2026-10-07T00:00:02Z"));
  expect(counts).toEqual({ aggregateRows: 30, keyedRows: 1, tree: 1 });
  reset();
  const current = mates[ids[0]!]!;
  deliver({ ...current, main: { ...current.main!, hasPendingUserInput: true } });
  expect(counts).toEqual({ aggregateRows: 30, keyedRows: 1, tree: 1 });
});
