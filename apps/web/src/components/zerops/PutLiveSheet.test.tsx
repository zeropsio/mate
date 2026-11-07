// @vitest-environment happy-dom
import { flowChange } from "@t3tools/client-runtime/zerops";
import { HqChange } from "@t3tools/shared/hqChanges";
import * as Schema from "effect/Schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { putLiveSheet } from "~/zerops/putLive.logic";

import { Dialog } from "../ui/dialog";
import { PutLiveSheet } from "./PutLiveSheet";

const sha = "a".repeat(40);
const mergedChange = flowChange(
  Schema.decodeUnknownSync(HqChange)({
    appId: "tea-shop",
    repo: "shop-front",
    number: 1,
    mateProjectId: "fen",
    title: "Shop front: list, filter and order products",
    body: "- Add a recipe\n- Browse every recipe\n- Search by ingredient\n- Cook",
    state: "merged",
    head: sha,
    mergedSha: sha,
    landedHead: sha,
    openedAt: "2026-10-06T00:00:00Z",
    mergedAt: "2026-10-06T01:00:00Z",
    closedAt: null,
    updatedAt: "2026-10-06T01:00:00Z",
    mergeability: "clean",
    behind: false,
    ready: true,
    comments: null,
  }),
  "https://hq.example.test",
);

let root: Root | undefined;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

function render(
  recipe: Parameters<typeof putLiveSheet>[0]["recipe"],
  handlers: { onPutLive?: () => void; onSeeCode?: () => void } = {},
) {
  root ??= createRoot(host);
  act(() =>
    root!.render(
      <Dialog open onOpenChange={() => {}}>
        <PutLiveSheet
          model={putLiveSheet({
            project: "Tea Shop",
            changes: [mergedChange],
            recipe,
          })}
          onPutLive={handlers.onPutLive ?? (() => {})}
          onSeeCode={handlers.onSeeCode}
        />
      </Dialog>,
    ),
  );
  return document.body;
}

const button = (body: HTMLElement, name: string) =>
  [...body.querySelectorAll("button")].find((entry) => entry.textContent === name);

describe("the Put it live sheet", () => {
  it("shows what goes live, where, stage for later, and one button that puts it live", () => {
    const onPutLive = vi.fn();
    const onSeeCode = vi.fn();
    const body = render("present", { onPutLive, onSeeCode });
    const text = body.textContent ?? "";
    expect(text).toContain("Put Tea Shop live");
    expect(text).toContain("Shop front: list, filter and order products");
    expect(text).toContain("Search by ingredient");
    expect(text).not.toContain("Cook");
    expect(text).toContain("Production");
    expect(text).toContain("Want somewhere to test first? Add a stage later from the project.");
    // Nothing it already knows is asked: no name, no recipe, no version, no stage.
    expect(body.querySelectorAll("input")).toHaveLength(0);

    act(() => button(body, "See the code")?.click());
    expect(onSeeCode).toHaveBeenCalledOnce();
    act(() => button(body, "Put it live")?.click());
    expect(onPutLive).toHaveBeenCalledOnce();
  });

  it("holds its button while the production recipe is read, saying why", () => {
    const body = render("loading");
    expect(body.textContent).toContain("Reading how the project runs…");
    expect(button(body, "Put it live")?.hasAttribute("disabled")).toBe(true);
  });
});
