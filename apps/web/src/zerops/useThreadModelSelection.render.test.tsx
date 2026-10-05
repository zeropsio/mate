import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { createModelCapabilities } from "@t3tools/shared/model";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type ModelCapabilities,
  type ModelSelection,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../composerDraftStore";
import { useThreadModelSelection } from "./useThreadModelSelection";

const claude = ProviderInstanceId.make("claudeAgent");
const threadRef = scopeThreadRef(EnvironmentId.make("environment-local"), ThreadId.make("t"));
const withEffort = (effort: string): ModelSelection => ({
  instanceId: claude,
  model: "claude-opus",
  options: [{ id: "effort", value: effort }],
});
const draftPick = () =>
  useComposerDraftStore.getState().getComposerDraft(threadRef)?.modelSelectionByProvider[claude];

// claude-opus and claude-sonnet take an effort; claude-haiku takes none.
const effortCaps = createModelCapabilities({
  optionDescriptors: [
    {
      id: "effort",
      label: "Effort",
      type: "select",
      options: ["low", "xhigh", "max"].map((id) => ({ id, label: id })),
    },
  ],
});
const capabilitiesFor = (selection: ModelSelection): ModelCapabilities =>
  selection.model === "claude-haiku"
    ? createModelCapabilities({ optionDescriptors: [] })
    : effortCaps;

let tree: ReactTestRenderer | undefined;
const write = vi.fn<(selection: ModelSelection) => void>();
function Probe(props: { threadRef: ScopedThreadRef | null; threadSelection: ModelSelection }) {
  useThreadModelSelection({ ...props, write, capabilitiesFor });
  return null;
}
const mount = (threadSelection: ModelSelection, ref: ScopedThreadRef | null = threadRef) =>
  act(() => {
    tree = create(<Probe threadRef={ref} threadSelection={threadSelection} />);
  });
const rerender = (threadSelection: ModelSelection) =>
  act(() => tree?.update(<Probe threadRef={threadRef} threadSelection={threadSelection} />));
const pick = (selection: ModelSelection) =>
  act(() => useComposerDraftStore.getState().setModelSelection(threadRef, selection));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  write.mockReset();
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("useThreadModelSelection", () => {
  it("a tab's stale pick gives way to the thread's selection when it opens", () => {
    pick(withEffort("xhigh"));
    mount(withEffort("max"));
    expect(draftPick()).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it("a pick made in the tab goes to the thread at once", () => {
    mount(withEffort("max"));
    pick(withEffort("xhigh"));
    expect(write).toHaveBeenCalledExactlyOnceWith(withEffort("xhigh"));
  });

  it("a pick is written once while the thread has not taken it yet", () => {
    mount(withEffort("max"));
    pick(withEffort("xhigh"));
    act(() => useComposerDraftStore.getState().setPrompt(threadRef, "still typing"));
    rerender(withEffort("max"));
    expect(write).toHaveBeenCalledOnce();
  });

  it("the thread's selection changed in another tab replaces this tab's pick", () => {
    mount(withEffort("max"));
    pick(withEffort("xhigh"));
    write.mockReset();
    rerender(withEffort("low"));
    expect(draftPick()).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a model that takes the effort keeps it",
      model: "claude-sonnet",
      written: {
        instanceId: claude,
        model: "claude-sonnet",
        options: [{ id: "effort", value: "xhigh" }],
      },
    },
    {
      name: "a model without effort goes without it",
      model: "claude-haiku",
      written: { instanceId: claude, model: "claude-haiku" },
    },
  ])("switching model keeps the thread's options: $name", ({ model, written }) => {
    mount(withEffort("xhigh"));
    pick({ instanceId: claude, model });
    expect(write).toHaveBeenCalledExactlyOnceWith(written);
  });

  it("a local draft thread keeps its own pick", () => {
    pick(withEffort("xhigh"));
    mount(withEffort("max"), null);
    expect(draftPick()).toEqual(withEffort("xhigh"));
    expect(write).not.toHaveBeenCalled();
  });
});
