// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ProjectSitesInput } from "../zerops/SidebarProjectSites";
import { ProjectPageLink } from "./ChatHeaderLinks";

const sites = (onOpenPage: (() => void) | undefined): ProjectSitesInput => ({
  groupId: "tea-shop",
  projectName: "Tea Shop",
  production: undefined,
  stages: undefined,
  mates: [],
  prodChip: undefined,
  stageChip: undefined,
  line: undefined,
  onAskToFix: undefined,
  onOpenStop: () => undefined,
  onOpenPage,
});

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

function mount(input: ProjectSitesInput | undefined) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<ProjectPageLink sites={input} />));
  return host.querySelector<HTMLElement>('[data-zerops-surface="header-project-page"]');
}

describe("the conversation header's project link", () => {
  it("a Mate's conversation header opens its project's page", () => {
    const opened = vi.fn();
    const door = mount(sites(opened));
    expect(door?.getAttribute("aria-label")).toBe("Open Tea Shop");
    act(() => door?.click());
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("a conversation whose Mate is in no project offers no project link", () => {
    expect(mount(undefined)).toBeNull();
    act(() => root?.unmount());
    expect(mount(sites(undefined))).toBeNull();
  });
});
