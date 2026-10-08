/**
 * HQ's update, opened by an admin: it says where HQ stands as Zerops's facts say it now, offers
 * what they show, runs the one update pressed, and follows the facts after it.
 */
import type { HqUpdateState } from "@t3tools/client-runtime/zerops/hq";
import {
  makeAccountStore,
  makeOperations,
  runToEnd,
  runningScope,
} from "@t3tools/client-runtime/data";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { act, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsHqUpdatePanel, type HqUpdateOutcome, type HqUpdateRead } from "./ZeropsHqUpdate";

const CARRIED = "20261004T100000Z.0123456789ab";
const OLDER = "20261003T080500Z.ba9876543210";
const ORG = "org";
const AVAILABLE: HqUpdateState = { kind: "available", running: OLDER, carried: CARRIED };

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
});

async function mount(element: ReactElement): Promise<ReactTestRenderer> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(
      <Dialog open onOpenChange={() => {}}>
        {element}
      </Dialog>,
    );
  });
  mounted.push(tree!);
  return tree!;
}

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children.filter((child) => typeof child === "string"))
    .join(" ");

const action = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) => node.type === "button" && node.props["data-hq-update-action"] === true,
  )[0];

const shown = (state: HqUpdateState): HqUpdateRead => ({ kind: "read", state });

describe("ZeropsHqUpdatePanel", () => {
  it.each(["FINISHED", "FAILED"] as const)(
    "follows the actual update receipt to its process's %s outcome",
    async (status) => {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const scope = runningScope(ORG);
      for (const event of [
        { kind: "demand", demanded: true },
        { kind: "handshake" },
        { kind: "baseline-committed" },
      ] as const)
        store.dispatch({ kind: "stream", key: "zerops:org", now: 0, event });
      for (const event of [
        { kind: "demand", demanded: true },
        { kind: "attempt" },
        { kind: "handshake" },
      ] as const)
        store.dispatch({ kind: "stream", key: scope, now: 0, event });
      store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
      store.dispatch({
        kind: "baseline-commit",
        scope,
        generation: 1,
        via: "zerops-realtime",
        members: [],
        rows: [],
      });
      store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "baseline-committed" } });
      const operations = makeOperations({
        store,
        makeId: () => "update-receipt",
        executors: {
          zerops: {
            submit: (id, intent) =>
              intent.kind === "hq-update"
                ? Effect.succeed({
                    requestId: id,
                    operationId: "original-update",
                    executor: "zerops",
                    handles: ["original-update"],
                    affected: [{ family: "process", id: "original-update" }],
                    acceptance: { kind: "accepted", result: { processId: "original-update" } },
                    outcome: { kind: "pending" },
                  })
                : Effect.die("Unexpected operation"),
          },
        },
      });
      let accepted!: () => void;
      const receipt = new Promise<void>((resolve) => {
        accepted = resolve;
      });
      const runOperation = runToEnd({
        registry,
        store,
        operations: {
          ...operations,
          submit: (intent, id) =>
            Effect.tap(operations.submit(intent, id), () => Effect.sync(accepted)),
        },
      });
      const run = async (): Promise<HqUpdateOutcome> => {
        try {
          await runOperation(
            {
              kind: "hq-update",
              orgId: ORG,
              projectId: "hq-project",
              serviceId: "hq-service",
              running: OLDER,
              carried: CARRIED,
            },
            { orgId: ORG, unobserved: "HQ's update cannot be followed." },
          );
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            reason: error instanceof Error ? error.message : "HQ's update cannot be followed.",
          };
        }
      };
      const tree = await mount(
        <ZeropsHqUpdatePanel answering={OLDER} read={shown(AVAILABLE)} run={run} />,
      );
      await act(async () => {
        action(tree)!.props.onClick();
        await receipt;
      });
      expect(text(tree)).toContain("Updating HQ… It keeps serving until the new Core answers.");
      expect(text(tree)).not.toContain("finished");
      expect(action(tree)?.props.disabled).toBe(true);
      await act(async () => {
        store.dispatch({
          kind: "rows",
          scope: runningScope(ORG),
          generation: 1,
          method: "push",
          via: "zerops-realtime",
          rows: [
            {
              family: "process",
              id: "original-update",
              value: {
                id: "original-update",
                projectId: "hq-project",
                serviceStackIds: ["hq-service"],
                actionName: "stack.build",
                status,
                created: "2026-10-07T08:00:00Z",
                appVersion: { id: "version", name: `hq-core.${CARRIED}` },
              },
              revision: { kind: "zerops", version: 1 },
            },
          ],
        });
      });
      if (status === "FINISHED") {
        expect(text(tree)).toContain("finished. Waiting for HQ to answer with it.");
        expect(action(tree)).toBeUndefined();
      } else {
        expect(text(tree)).toContain(`HQ's update failed. HQ still runs ${OLDER}.`);
        expect(action(tree)?.props.disabled).toBe(false);
      }
      registry.dispose();
    },
  );

  it("offers the update Zerops's facts show", async () => {
    const tree = await mount(
      <ZeropsHqUpdatePanel answering={OLDER} read={shown(AVAILABLE)} run={vi.fn()} />,
    );
    expect(text(tree)).toContain(
      "HQ runs Core 2026-10-03 08:05 UTC · ba9876543210. This app carries Core 2026-10-04 10:00 UTC · 0123456789ab.",
    );
    expect(action(tree)?.props.disabled).toBe(false);
  });

  it("says it reads HQ from Zerops until the facts are there", async () => {
    const tree = await mount(
      <ZeropsHqUpdatePanel answering={OLDER} read={{ kind: "reading" }} run={vi.fn()} />,
    );
    expect(text(tree)).toContain("Reading HQ from Zerops…");
    expect(action(tree)).toBeUndefined();
  });

  it("runs one update, says HQ serves meanwhile, and says how it ended beside the facts", async () => {
    let end: (outcome: HqUpdateOutcome) => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<HqUpdateOutcome>((resolve) => {
          end = resolve;
        }),
    );
    const panel = (read: HqUpdateRead) => (
      <Dialog open onOpenChange={() => {}}>
        <ZeropsHqUpdatePanel answering={OLDER} read={read} run={run} />
      </Dialog>
    );
    const tree = await mount(
      <ZeropsHqUpdatePanel answering={OLDER} read={shown(AVAILABLE)} run={run} />,
    );
    await act(async () => {
      action(tree)!.props.onClick();
      action(tree)!.props.onClick();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(text(tree)).toContain("Updating HQ… It keeps serving until the new Core answers.");
    expect(action(tree)?.props.disabled).toBe(true);
    await act(async () => {
      tree.update(
        panel(
          shown({
            kind: "failed",
            running: OLDER,
            carried: CARRIED,
            reason: "readiness check failed",
          }),
        ),
      );
      end({ ok: false, reason: "HQ's update failed. HQ still runs its Core." });
    });
    expect(text(tree)).toContain("HQ's update failed. HQ still runs its Core.");
    expect(text(tree)).toContain("HQ's last update failed: readiness check failed.");
    expect(action(tree)?.props.disabled).toBe(false);
  });

  it("offers nothing while Zerops shows an update under way", async () => {
    const tree = await mount(
      <ZeropsHqUpdatePanel
        answering={OLDER}
        read={shown({ kind: "updating", target: CARRIED })}
        run={vi.fn()}
      />,
    );
    expect(text(tree)).toContain(
      "HQ is being updated to Core 2026-10-04 10:00 UTC · 0123456789ab.",
    );
    expect(action(tree)).toBeUndefined();
  });

  it("says why Zerops could not be read, and offers nothing", async () => {
    const tree = await mount(
      <ZeropsHqUpdatePanel
        answering={OLDER}
        read={{ kind: "unread", reason: "Zerops refused to say." }}
        run={vi.fn()}
      />,
    );
    expect(text(tree)).toContain("Couldn't read HQ from Zerops: Zerops refused to say.");
    expect(action(tree)).toBeUndefined();
  });

  it("shows the Core HQ runs once it is up to date, and offers nothing", async () => {
    const tree = await mount(
      <ZeropsHqUpdatePanel
        answering={CARRIED}
        read={shown({ kind: "current", running: CARRIED })}
        run={vi.fn()}
      />,
    );
    expect(text(tree)).toContain(
      "HQ runs Core 2026-10-04 10:00 UTC · 0123456789ab. It is up to date.",
    );
    expect(action(tree)).toBeUndefined();
  });

  it("never offers again the update it just ran, while Zerops and HQ catch up", async () => {
    // Measured on KRLS, 2026-10-04: for 9 s after the build finished, the panel offered it again.
    const tree = await mount(
      <ZeropsHqUpdatePanel
        answering={OLDER}
        read={shown(AVAILABLE)}
        run={async () => ({ ok: true })}
      />,
    );
    await act(async () => {
      action(tree)!.props.onClick();
    });
    expect(text(tree)).toContain(
      "HQ's update to Core 2026-10-04 10:00 UTC · 0123456789ab finished. Waiting for HQ to answer with it.",
    );
    expect(action(tree)).toBeUndefined();
  });
});
