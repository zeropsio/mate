import { EnvironmentId, ThreadId, type ThreadFileWritesInput } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { FileWriteDetail } from "./FileWriteDetail";
import { TimelineRowCtx, type TimelineRowSharedState } from "./timelineContext";

const asked: ThreadFileWritesInput[] = [];
const openFile = vi.fn();

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => ask,
}));

async function ask({ input }: { readonly input: ThreadFileWritesInput }) {
  asked.push(input);
  return {
    _tag: "Success",
    value: {
      calls: [
        {
          toolCallId: "call-edit",
          writes: [
            {
              path: "/srv/app/src/a.ts",
              kind: "edit",
              format: "diff",
              text: " keep\n-was\n+is",
              truncated: false,
            },
          ],
        },
        {
          toolCallId: "call-plan",
          writes: [
            {
              path: "/tmp/plan.md",
              kind: "write",
              format: "content",
              text: "# Plan",
              truncated: true,
            },
          ],
        },
      ],
    },
  };
}

vi.mock("../../state/threadFileWritesCommands", () => ({
  threadFileWritesCommands: { fileWrites: {}, readWrittenFile: {} },
}));

vi.mock("../../rightPanelStore", () => ({
  useRightPanelStore: { getState: () => ({ openFile }) },
}));

const threadRef = {
  environmentId: EnvironmentId.make("environment-local"),
  threadId: ThreadId.make("thread-1"),
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  asked.length = 0;
  openFile.mockClear();
});

/** The card's item box, as the row hands it: here, a mark of where each file's text stands. */
const box = (part: string, children: ReactNode) => <div data-item-box={part}>{children}</div>;

const texts = (node: ReactTestRenderer) =>
  node.root
    .findAll((child) => child.children.every((part) => typeof part === "string"))
    .map((child) => child.children.join(""));

describe("FileWriteDetail — what a write or an edit wrote, opened under its row", () => {
  it("draws each file's change and opens it in Files, inside the workspace or out", async () => {
    await act(async () => {
      renderer = create(
        <TimelineRowCtx
          value={{ threadRef, workspaceRoot: "/srv/app" } as unknown as TimelineRowSharedState}
        >
          <FileWriteDetail box={box} callIds={["call-edit", "call-plan"]} />
        </TimelineRowCtx>,
      );
    });
    const drawn = renderer!;
    expect(asked).toEqual([{ threadId: "thread-1", toolCallIds: ["call-edit", "call-plan"] }]);

    // Each file's text stands in the card's own item box, as every item's does.
    expect(
      drawn.root
        .findAll((node) => node.props["data-item-box"] !== undefined)
        .map((node) => node.props["data-item-box"]),
    ).toEqual(["write:0", "write:1"]);
    const lines = drawn.root.findAll((node) => node.props["data-diff-line"] !== undefined);
    expect(lines.map((line) => line.props["data-diff-line"])).toEqual(["kept", "removed", "added"]);
    expect(texts(drawn)).toEqual(
      expect.arrayContaining(["src/a.ts", "was", "is", "/tmp/plan.md", "# Plan"]),
    );
    expect(texts(drawn)).toContain("Cut here: the file holds the rest.");

    const opens = drawn.root.findAll((node) => node.props["data-open-in-files"] !== undefined);
    expect(opens.map((button) => button.props["data-open-in-files"])).toEqual([
      "workspace",
      "outside",
    ]);
    act(() => opens[0]!.props.onClick());
    act(() => opens[1]!.props.onClick());
    expect(openFile.mock.calls).toEqual([
      [threadRef, "src/a.ts"],
      [threadRef, "/tmp/plan.md"],
    ]);
  });

  it("asks nothing again for a row opened again", async () => {
    await act(async () => {
      renderer = create(
        <TimelineRowCtx
          value={{ threadRef, workspaceRoot: "/srv/app" } as unknown as TimelineRowSharedState}
        >
          <FileWriteDetail box={box} callIds={["call-edit", "call-plan"]} />
        </TimelineRowCtx>,
      );
    });
    expect(asked).toEqual([]);
    expect(
      renderer!.root.findAll((node) => node.props["data-diff-line"] !== undefined),
    ).toHaveLength(3);
  });
});
