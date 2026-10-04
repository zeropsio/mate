/**
 * HQ's update, opened by an admin: it reads Zerops once shown, offers what it read, runs the one
 * update pressed and reads Zerops again after it — never on its own.
 */
import type { HqUpdateOutcome, HqUpdateState } from "@t3tools/client-runtime/zerops/hq";
import { act, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsHqUpdatePanel } from "./ZeropsHqUpdate";

const CARRIED = "20261004T100000Z.0123456789ab";
const OLDER = "20261003T080500Z.ba9876543210";
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

describe("ZeropsHqUpdatePanel", () => {
  it("reads Zerops once shown and offers the update it read", async () => {
    const read = vi.fn(async () => AVAILABLE);
    const tree = await mount(<ZeropsHqUpdatePanel read={read} run={vi.fn()} />);
    expect(read).toHaveBeenCalledTimes(1);
    expect(text(tree)).toContain(
      "HQ runs Core 2026-10-03 08:05 UTC · ba9876543210. This app carries Core 2026-10-04 10:00 UTC · 0123456789ab.",
    );
    expect(action(tree)?.props.disabled).toBe(false);
  });

  it("runs one update, says HQ serves meanwhile, and reads Zerops again once it ends", async () => {
    let end: (outcome: HqUpdateOutcome) => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<HqUpdateOutcome>((resolve) => {
          end = resolve;
        }),
    );
    const read = vi
      .fn<() => Promise<HqUpdateState>>()
      .mockResolvedValueOnce(AVAILABLE)
      .mockResolvedValueOnce({
        kind: "failed",
        running: OLDER,
        carried: CARRIED,
        reason: "readiness check failed",
      });
    const tree = await mount(<ZeropsHqUpdatePanel read={read} run={run} />);
    await act(async () => {
      action(tree)!.props.onClick();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(text(tree)).toContain("Updating HQ… It keeps serving until the new Core answers.");
    expect(action(tree)?.props.disabled).toBe(true);
    await act(async () => {
      end({ ok: false, reason: "HQ's update failed. HQ still runs its Core." });
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(text(tree)).toContain("HQ's update failed. HQ still runs its Core.");
    expect(text(tree)).toContain("HQ's last update failed: readiness check failed.");
    expect(action(tree)?.props.disabled).toBe(false);
  });

  it("offers nothing while Zerops shows an update under way", async () => {
    const tree = await mount(
      <ZeropsHqUpdatePanel
        read={async () => ({ kind: "updating", target: CARRIED })}
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
        read={async () => {
          throw new Error("Zerops could not be reached.");
        }}
        run={vi.fn()}
      />,
    );
    expect(text(tree)).toContain("Couldn't read HQ from Zerops: Zerops could not be reached.");
    expect(action(tree)).toBeUndefined();
  });
});
