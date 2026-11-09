// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ProjectPageLink } from "./ChatHeaderLinks";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

function mount(input: { readonly projectName?: string; readonly onOpen?: () => void }) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(<ProjectPageLink onOpen={input.onOpen} projectName={input.projectName} />),
  );
  return host.querySelector<HTMLElement>('[data-zerops-surface="header-project-page"]');
}

describe("the conversation header's project link", () => {
  it("a Mate's conversation header opens its project's page", () => {
    const opened = vi.fn();
    const door = mount({ projectName: "Tea Shop", onOpen: opened });
    expect(door?.getAttribute("aria-label")).toBe("Open Tea Shop");
    act(() => door?.click());
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("a conversation whose Mate is in no project offers no project link", () => {
    expect(mount({})).toBeNull();
  });
});
