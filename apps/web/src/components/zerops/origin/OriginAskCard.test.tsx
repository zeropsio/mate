// @vitest-environment happy-dom
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { GitMirrorApp } from "../gitMirror.logic";
import { OriginAskCard, type OriginAskCardProps } from "./OriginAskCard";
import { originAskFace, originConnected } from "./originAsk.logic";

const ask = {
  url: "https://github.com/zeropsio/mate",
  repo: "appdev",
  reason: "So finished work lands back on GitHub.",
};
const unmounted: ReadonlyArray<RepoListEntry> = [
  { name: "appdev", mainHead: "a".repeat(40), updatedAt: "2026-10-17T10:00:00Z" },
];
const mounted: ReadonlyArray<RepoListEntry> = [
  {
    ...unmounted[0]!,
    remote: {
      url: "https://github.com/zeropsio/mate",
      repositoryId: "42",
      keptAt: "2026-10-17T10:00:00Z",
      keptBy: "viewer",
      expiresAt: null,
      invalidSince: null,
      via: "app",
      governance: "permission_not_approved",
    },
  },
];
const app: GitMirrorApp = {
  kind: "connected",
  name: "Acme Mate",
  appId: 7,
  repositories: ["zeropsio/mate"],
  installUrl: "https://github.com/apps/acme-mate/installations/new",
};

let root: Root;
let host: HTMLDivElement;
let props: OriginAskCardProps;

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
async function draw(over: Partial<OriginAskCardProps> = {}) {
  props = { ...props, ...over };
  await act(async () => root.render(<OriginAskCard {...props} />));
}
async function drawGithub(over: Partial<NonNullable<OriginAskCardProps["github"]>>) {
  await draw({ github: { ...props.github!, ...over } });
}
const sheet = () => page().querySelector('[data-origin-github-sheet=""]');

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    ask,
    face: "open",
    mateName: "Fen",
    github: {
      app,
      repos: unmounted,
      mountable: true,
      refusal: undefined,
      onMount: vi.fn(async () => null),
      onCheckAgain: vi.fn(),
      onOpenAutomation: vi.fn(),
    },
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
  it("An origin ask offers keeping the code on GitHub or in Mate, and no token", async () => {
    expect(host.textContent).toContain("Where do you keep the code of github.com/zeropsio/mate?");
    expect(button("Keep the code on GitHub")).toBeDefined();
    expect(button("Keep the code in Mate")).toBeDefined();
    expect(button("Not now")).toBeUndefined();
    expect(page().textContent).not.toMatch(/token|Git environment|governed|advisory/iu);
  });

  it("Keeping the code in Mate answers in Mate and folds the card", async () => {
    await click("Keep the code in Mate");
    expect(props.onAnswer).toHaveBeenCalledWith("declined");
    expect(sheet()).toBeNull();
    await draw({ face: "declined" });
    expect(host.textContent).toContain("github.com/zeropsio/mate · Kept in Mate");
    expect(button("Keep the code on GitHub")).toBeUndefined();
  });

  it("Keeping the code on GitHub mounts the asked repository through the organization's GitHub app", async () => {
    await click("Keep the code on GitHub");
    expect(sheet()?.textContent).toContain("Acme Mate reaches zeropsio/mate.");
    await click("Connect zeropsio/mate");
    expect(props.github!.onMount).toHaveBeenCalledWith("zeropsio/mate");
    // HQ mounts it: the container's record answers connected, and the card folds.
    expect(props.onAnswer).not.toHaveBeenCalled();
    await draw({
      github: { ...props.github!, repos: mounted },
      face: originAskFace("open", null, originConnected(ask, mounted)),
    });
    expect(host.textContent).toContain("github.com/zeropsio/mate · Kept on GitHub");
    // The sheet stays to say what GitHub still lets through.
    expect(sheet()?.textContent).toContain("appdev keeps its code on github.com/zeropsio/mate");
    expect(sheet()?.textContent).toContain("Acme Mate (app ID 7) can't set mate/gate yet");
    await click("Done");
    expect(sheet()).toBeNull();
  });

  it.each([
    {
      case: "the organization has no GitHub app",
      github: { app: { kind: "none" } as const },
      says: "Your organization has no GitHub app yet.",
      press: "Connect GitHub in Settings › Automation",
      calls: "onOpenAutomation",
    },
    {
      case: "the app does not reach the repository",
      github: { app: { ...app, repositories: ["zeropsio/other"] } },
      says: "Acme Mate doesn't reach zeropsio/mate yet.",
      press: "Check again",
      calls: "onCheckAgain",
    },
    {
      case: "HQ could not say whether there is an app",
      github: { app: { kind: "unknown" } as const },
      says: "HQ didn't say whether your organization has a GitHub app.",
      press: "Check again",
      calls: "onCheckAgain",
    },
  ] as const)(
    "Keeping the code on GitHub says what is missing when $case",
    async ({ github, says, press, calls }) => {
      await drawGithub(github);
      await click("Keep the code on GitHub");
      expect(sheet()?.textContent).toContain(says);
      expect(button("Connect zeropsio/mate")).toBeUndefined();
      await click(press);
      expect(props.github![calls]).toHaveBeenCalled();
    },
  );

  it("Keeping the code on GitHub says HQ's refusal where the person may not mount it", async () => {
    await drawGithub({ mountable: false, refusal: "Only an Owner or Admin can do this." });
    await click("Keep the code on GitHub");
    expect(sheet()?.textContent).toContain("Only an Owner or Admin can do this.");
    expect(button("Connect zeropsio/mate")).toBeUndefined();
  });

  it("A repository outside GitHub is only kept in Mate", async () => {
    await draw({ ask: { ...ask, url: "https://gitlab.com/zeropsio/mate" } });
    expect(button("Keep the code on GitHub")).toBeUndefined();
    await click("Keep the code in Mate");
    expect(props.onAnswer).toHaveBeenCalledWith("declined");
  });

  it("An origin card whose origin is already connected says so and offers no Not now", async () => {
    // HQ mounted it while the sheet was closed: the engine's record is still open.
    await draw({ face: originAskFace("open", null, originConnected(ask, mounted)) });
    expect(host.textContent).toContain("github.com/zeropsio/mate · Kept on GitHub");
    expect(button("Keep the code on GitHub")).toBeUndefined();
    expect(button("Keep the code in Mate")).toBeUndefined();
    expect(button("Not now")).toBeUndefined();
  });

  it("Closing the sheet keeps the origin ask open", async () => {
    await click("Keep the code on GitHub");
    expect(sheet()).not.toBeNull();
    await click("Cancel");
    expect(sheet()).toBeNull();
    expect(props.onAnswer).not.toHaveBeenCalled();
    expect(button("Keep the code in Mate")).toBeDefined();
    await click("Keep the code on GitHub");
    expect(sheet()?.textContent).toContain("Acme Mate reaches zeropsio/mate.");
  });
});
