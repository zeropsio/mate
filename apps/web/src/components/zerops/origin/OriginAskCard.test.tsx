// @vitest-environment happy-dom
import type { HqGitAdoption, RepoListEntry } from "@t3tools/shared/hqChanges";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { GitEnvironmentFormInputs } from "~/zerops/useGitEnvironmentFormInputs";
import { OriginAskCard, type OriginAskCardProps } from "./OriginAskCard";

const ask = {
  url: "https://github.com/zeropsio/mate",
  repo: "appdev",
  reason: "So finished work lands back on GitHub.",
};
const remote = {
  url: "https://github.com/zeropsio/mate",
  repositoryId: "42",
  keptAt: "2026-10-17T10:00:00Z",
  keptBy: "viewer",
  expiresAt: null,
  invalidSince: null,
};
const connected: ReadonlyArray<RepoListEntry> = [
  { name: "appdev", mainHead: "a".repeat(40), updatedAt: "2026-10-17T10:00:00Z", remote },
];
const adoption = (branch: string): HqGitAdoption => ({
  repo: "appdev",
  remote,
  branch,
  mainHead: "a".repeat(40),
  remoteHead: "c".repeat(40),
  changedFiles: 120,
  seed: true,
});

let root: Root;
let host: HTMLDivElement;
let props: OriginAskCardProps;
let git: GitEnvironmentFormInputs;

const page = () => document.body;
const button = (text: string) =>
  Array.from(page().querySelectorAll<HTMLButtonElement>("button")).find(
    (entry) => entry.textContent === text,
  );
async function click(text: string) {
  const target = button(text);
  if (target === undefined) throw new Error(`No button "${text}"`);
  await act(async () => target.click());
}
const field = (text: string) => {
  const label = Array.from(page().querySelectorAll("label")).find(
    (node) => node.textContent === text,
  );
  return label === undefined
    ? null
    : page().querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`);
};
async function enter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function draw(over: Partial<OriginAskCardProps> = {}) {
  props = { ...props, ...over };
  await act(async () => root.render(<OriginAskCard {...props} />));
}
const sheetOpen = () => page().querySelector('[data-zerops-surface="git-environment-form"]');

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  git = {
    takenNames: [],
    repos: [],
    offered: { add: true, connect: true, replace: true },
    unavailableReason: undefined,
    setup: {
      connect: vi.fn(async () => ({ ok: false as const, reason: "This token cannot push." })),
      preview: vi.fn(async (branch: string) => [adoption(branch)]),
      add: vi.fn(async () => {}),
    },
  };
  props = {
    ask,
    face: "open",
    mateName: "Fen",
    application: { name: "Shop", git },
    onAnswer: vi.fn(async () => null),
  };
  await draw();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("an origin asked of the person", () => {
  it("An origin ask's Connect opens the Git sheet with the asked address and repository name", async () => {
    expect(host.textContent).toContain("Deliver finished work back to github.com/zeropsio/mate?");
    await click("Connect");
    expect(field("Repository")?.value).toBe("github.com/zeropsio/mate");
    await click("Continue");
    await enter(field("Token")!, "github_pat_x");
    await click("Test");
    // The HQ repository is the one the Mate will wire, named by the ask — never the address's `mate`.
    expect(git.setup.connect).toHaveBeenCalledWith(
      "appdev",
      "https://github.com/zeropsio/mate",
      "github_pat_x",
      false,
    );
  });

  it("After production is added from an origin ask the sheet offers stage on mate/stage", async () => {
    await draw({ application: { name: "Shop", git: { ...git, repos: connected } } });
    await click("Connect");
    await click("Continue");
    expect(field("Branch")?.value).toBe("main");
    await click("Add production to Shop");
    expect(git.setup.add).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "production",
        target: { kind: "git", branch: "main", delivery: "direct" },
      }),
    );
    expect(props.onAnswer).toHaveBeenCalledWith("connected");
    // The engine's record folds the card; the same sheet goes on to stage.
    await draw({ face: "connected" });
    expect(host.textContent).toContain("Connected");
    expect(sheetOpen()).not.toBeNull();
    expect(field("Branch")?.value).toBe("mate/stage");
    expect(button("Add stage to Shop")).toBeDefined();
  });

  it("Not now answers declined", async () => {
    await click("Not now");
    expect(props.onAnswer).toHaveBeenCalledWith("declined");
    expect(sheetOpen()).toBeNull();
    await draw({ face: "declined" });
    expect(host.textContent).toContain("Not delivering back");
    expect(button("Connect")).toBeUndefined();
  });

  it("Closing the sheet keeps the origin ask open", async () => {
    await click("Connect");
    expect(sheetOpen()).not.toBeNull();
    await click("Cancel");
    expect(sheetOpen()).toBeNull();
    expect(props.onAnswer).not.toHaveBeenCalled();
    expect(button("Not now")).toBeDefined();
    await click("Connect");
    expect(field("Repository")?.value).toBe("github.com/zeropsio/mate");
  });
});
