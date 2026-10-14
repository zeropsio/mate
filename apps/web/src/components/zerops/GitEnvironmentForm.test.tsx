// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { HqGitAdoption, RepoListEntry } from "@t3tools/shared/hqChanges";
import { Dialog } from "../ui/dialog";
import { GitEnvironmentForm, type GitEnvironmentFormProps } from "./GitEnvironmentForm";

const remote = {
  url: "https://github.com/acme/shop",
  repositoryId: "17",
  keptAt: "2026-10-13T10:00:00Z",
  keptBy: "viewer",
  expiresAt: null,
  invalidSince: null,
};
const repositories: ReadonlyArray<RepoListEntry> = [
  { name: "app", mainHead: "a".repeat(40), updatedAt: "2026-10-13T10:00:00Z", remote },
  { name: "worker", mainHead: "b".repeat(40), updatedAt: "2026-10-13T10:00:00Z", remote: null },
];
const review: HqGitAdoption = {
  repo: "app",
  remote,
  branch: "main",
  mainHead: "a".repeat(40),
  remoteHead: "c".repeat(40),
  changedFiles: 23,
  seed: false,
};
let root: Root;
let host: HTMLDivElement;
let props: GitEnvironmentFormProps;
const button = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (entry) => entry.textContent === text,
  )!;
async function click(text: string) {
  await act(async () => button(text).click());
}
async function enter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function draw(over: Partial<GitEnvironmentFormProps> = {}) {
  props = { ...props, ...over };
  await act(async () =>
    root.render(
      <Dialog>
        <GitEnvironmentForm {...props} />
      </Dialog>,
    ),
  );
}
async function confirm() {
  await act(async () => host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    groupName: "Shop",
    tier: "production",
    defaultName: "Shop - production",
    repos: repositories,
    offered: { add: true, connect: true, replace: true },
    onCancel: vi.fn(),
    onAdded: vi.fn(),
    setup: {
      connect: vi.fn(async () => ({ ok: false as const, reason: "This token cannot push." })),
      preview: vi.fn(async () => [review]),
      add: vi.fn(async () => {}),
    },
  };
  await draw();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Git environment setup's real form", () => {
  it("names included and left-out code repositories and shows unknown expiry exactly once", () => {
    expect(host.textContent).toContain("app · Included");
    expect(host.textContent).toContain("worker · Left out");
    expect(host.textContent?.match(/Expiry not reported/g)).toHaveLength(1);
    expect(button("Add production to Shop").disabled).toBe(true);
    expect(host.textContent).toContain(
      "Adding production pushes nothing. It starts with the next Release.",
    );
    expect(host.textContent).toContain("Mate must be the only one that writes to it");
  });
  it("requires the exact file count and explicit confirmation before any main move", async () => {
    expect(props.setup.add).not.toHaveBeenCalled();
    await click("Review branch");
    expect(host.textContent).toContain(
      "The first push changes 23 files on https://github.com/acme/shop main. Mate's copy wins.",
    );
    expect(props.setup.add).not.toHaveBeenCalled();
    expect(button("Add production to Shop").disabled).toBe(true);
    await confirm();
    expect(button("Add production to Shop").disabled).toBe(false);
    await click("Add production to Shop");
    expect(props.setup.add).toHaveBeenCalledExactlyOnceWith({
      tier: "production",
      name: "Shop - production",
      target: { kind: "git", branch: "main", delivery: "direct" },
      adoption: [review],
    });
    expect(props.onAdded).toHaveBeenCalledExactlyOnceWith("Shop - production");
  });
  it("makes a stale preview require review and confirmation again", async () => {
    await click("Review branch");
    await confirm();
    await draw({
      repos: repositories.map((repo) =>
        repo.name === "app" ? { ...repo, mainHead: "d".repeat(40) } : repo,
      ),
    });
    expect(host.textContent).toContain("changed while this was being reviewed. Review it again.");
    expect(button("Add production to Shop").disabled).toBe(true);
    await draw({ repos: repositories });
    expect(button("Add production to Shop").disabled).toBe(true);
    expect(props.setup.add).not.toHaveBeenCalled();
  });
  it("keeps the chosen branch as repository and role authority arrive after first paint", async () => {
    await draw({ repos: undefined, offered: { add: false, connect: false, replace: false } });
    const branch = Array.from(host.querySelectorAll<HTMLInputElement>("input")).find(
      (input) => input.value === "main",
    )!;
    await enter(branch, "production");
    await draw({ repos: repositories, offered: { add: true, connect: true, replace: true } });
    expect(branch.value).toBe("production");
    expect(host.textContent).toContain("worker · Left out");
    await click("Review branch");
    expect(props.setup.preview).toHaveBeenCalledExactlyOnceWith("production");
  });
  it("a failed candidate probe cannot connect or become an adoption input", async () => {
    await draw({ repos: repositories.map((repo) => ({ ...repo, remote: null })) });
    const urls = host.querySelectorAll<HTMLInputElement>('input[type="url"]');
    const tokens = host.querySelectorAll<HTMLInputElement>('input[type="password"]');
    await enter(urls[0]!, "https://github.com/acme/shop");
    await enter(tokens[0]!, "candidate");
    const branch = Array.from(host.querySelectorAll<HTMLInputElement>("input")).find(
      (input) => input.value === "main",
    )!;
    await enter(branch, "production");
    await click("Test and connect app");
    expect(props.setup.connect).toHaveBeenCalledExactlyOnceWith(
      "app",
      "https://github.com/acme/shop",
      "candidate",
      false,
      "production",
    );
    expect(tokens[0]!.value).toBe("");
    expect(host.textContent).toContain("app: This token cannot push.");
    expect(host.textContent).toContain("app · Left out");
    expect(button("Review branch").disabled).toBe(true);
    expect(props.setup.preview).not.toHaveBeenCalled();
    expect(props.setup.add).not.toHaveBeenCalled();
  });
  it("a delayed successful connection waits for the owner's repository record", async () => {
    let answer!: (value: { ok: true; remote: typeof remote }) => void;
    const pending = new Promise<{ ok: true; remote: typeof remote }>((resolve) => {
      answer = resolve;
    });
    await draw({
      repos: repositories.map((repo) => ({ ...repo, remote: null })),
      setup: { ...props.setup, connect: vi.fn(() => pending) },
    });
    await enter(host.querySelector<HTMLInputElement>('input[type="url"]')!, remote.url);
    await enter(host.querySelector<HTMLInputElement>('input[type="password"]')!, "candidate");
    await click("Test and connect app");
    expect(host.textContent).toContain("Testing the token and connecting the remote…");
    await act(async () => answer({ ok: true, remote }));
    expect(button("Review branch").disabled).toBe(true);
    await draw({ repos: repositories });
    expect(button("Review branch").disabled).toBe(false);
  });
  it("a remote-tip refusal discards the displayed preview before another add", async () => {
    await draw({
      setup: {
        ...props.setup,
        add: vi.fn(async () => {
          throw new Error("The remote branch moved. Review again.");
        }),
      },
    });
    await click("Review branch");
    await confirm();
    expect(button("Add production to Shop").disabled).toBe(false);
    await click("Add production to Shop");
    expect(host.textContent).toContain("The remote branch moved. Review again.");
    expect(button("Add production to Shop").disabled).toBe(true);
    expect(host.querySelector('[role="checkbox"]')).toBeNull();
  });
  it("cancel after remote setup submits no environment and leaves its remote connected", async () => {
    await click("Cancel");
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.setup.add).not.toHaveBeenCalled();
    expect(props.repos?.[0]?.remote?.url).toBe(remote.url);
  });
  it("pending Add prevents a second submission and says what closing means", async () => {
    let finish!: () => void;
    await draw({
      setup: {
        ...props.setup,
        add: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        ),
      },
    });
    await click("Review branch");
    await confirm();
    expect(button("Add production to Shop").disabled).toBe(false);
    await click("Add production to Shop");
    expect(button("Adding…").disabled).toBe(true);
    expect(host.textContent).toContain("HQ may accept it even if you close this form.");
    await click("Close");
    expect(props.onCancel).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(props.setup.add).toHaveBeenCalledOnce();
  });
  it("a Git stage never pushes the pre-attachment adoption automatically", async () => {
    await draw({ tier: "stage" });
    expect(host.textContent).toContain(
      "Adoption before attachment pushes nothing to this stage. Its first push follows the next main move.",
    );
    expect(props.setup.add).not.toHaveBeenCalled();
  });
});
