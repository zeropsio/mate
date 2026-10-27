// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { gitTokenGuide } from "@t3tools/shared/gitTokenGuide";
import type { HqGitAdoption, RepoListEntry } from "@t3tools/shared/hqChanges";
import { gitRemoteExpiry } from "@t3tools/client-runtime/zerops";
import { makeHqApi } from "@t3tools/client-runtime/zerops/hq";
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
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    groupName: "Shop",
    tier: "production",
    defaultName: "Shop - production",
    takenNames: [],
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

const field = (text: string) => {
  const label = Array.from(host.querySelectorAll("label")).find(
    (node) => node.textContent === text,
  )!;
  return host.querySelector<HTMLInputElement>(`#${label.htmlFor}`)!;
};
async function chooseRepository() {
  await enter(field("Repository"), remote.url);
  await click("Continue");
}

describe("Git environment setup's real form", () => {
  it("A person can never be blocked by a field they cannot see", async () => {
    await chooseRepository();
    expect(Array.from(host.querySelectorAll("label")).map((node) => node.textContent)).toEqual([
      "Branch",
    ]);
    await click("Add production to Shop");
    expect(props.setup.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: "shop-production" }),
    );
  });

  it("Adding Git production uses the names arriving after the form opened", async () => {
    await draw({ takenNames: undefined });
    await chooseRepository();
    expect(button("Add production to Shop").disabled).toBe(true);
    expect(host.textContent).toContain("Reading this project's environment names…");
    await draw({ takenNames: ["shop-production", "shop-production-2"] });
    await click("Add production to Shop");
    expect(props.setup.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: "shop-production-3" }),
    );
  });

  it("Adding Git production recalculates its name when another environment arrives", async () => {
    await chooseRepository();
    await draw({ takenNames: ["shop-production"] });
    await click("Add production to Shop");
    expect(props.setup.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: "shop-production-2" }),
    );
  });

  it.each([
    { groupName: "Shop", branch: "mate-prod-e2e-20261014", expected: "shop-production" },
    { groupName: "ACME.Web App", branch: "release-2026", expected: "acme-web-app-production" },
    { groupName: "123 Shop", branch: "123-release", expected: "shop-production" },
    { groupName: "9", branch: "release", expected: "production" },
    { groupName: "A".repeat(80), branch: "release", expected: "a".repeat(63) },
  ])(
    "Adding Git production sends a valid generated name for $groupName on $branch",
    async ({ groupName, branch, expected }) => {
      await draw({
        groupName,
        defaultName: `${groupName} - production`,
        setup: { ...props.setup, preview: vi.fn(async (branch) => [{ ...review, branch }]) },
      });
      await chooseRepository();
      await enter(field("Branch"), branch);
      await act(async () =>
        field("Branch").dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        ),
      );
      await click(`Add production to ${groupName}`);
      expect(props.setup.add).toHaveBeenCalledWith({
        tier: "production",
        name: expected,
        target: { kind: "git", branch, delivery: "direct" },
        adoption: [{ ...review, branch }],
      });
      expect(props.onAdded).toHaveBeenCalledWith(expected);
    },
  );

  it.each([
    ["token_invalid", "GitHub rejected this token. Create a replacement in GitHub token settings."],
    ["push_not_granted", "This token can't push. Choose Contents: Read and write."],
  ])("a token refusal shows the host's reason and fix: %s", async (reason, message) => {
    const api = makeHqApi({
      address: "https://hq.example.test",
      accessToken: async () => "access",
      orgId: "org-1",
      openSocket: () => {
        throw new Error("No socket expected");
      },
      fetch: async (url) =>
        Response.json(
          url.endsWith("/api/door")
            ? { session: "session", expiresAt: "2099-01-01T00:00:00Z", userId: "viewer" }
            : { code: "git_probe_refused", reason, message },
          { status: url.endsWith("/api/door") ? 200 : 409 },
        ),
    });
    await draw({
      repos: [],
      setup: {
        ...props.setup,
        connect: async (repo, url, candidate) => {
          await api.gitTargetWrite(
            "test",
            {
              kind: "connect-git-remote",
              orgId: "org",
              appId: "app",
              hqProjectId: "hq",
              repo,
              url,
            },
            candidate,
          );
          throw new Error("Expected the token refusal");
        },
      },
    });
    await chooseRepository();
    await enter(field("Token"), "candidate");
    await click("Test");
    expect(host.querySelector('[role="status"]')?.textContent).toBe(message);
    expect(host.textContent).not.toContain(reason);
    expect(field("Token").value).toBe("");
    expect(button("Test").disabled).toBe(true);
    expect(button("Continue").disabled).toBe(true);
  });
  it.each(["", "   ", "candidate"])(
    "Test follows the token field after Back and Continue: %j",
    async (candidate) => {
      await draw({ repos: [] });
      await chooseRepository();
      await enter(field("Token"), candidate);
      expect(button("Test").disabled).toBe(candidate.trim() === "");
      await click("Back");
      await click("Continue");
      expect(field("Token").value).toBe("");
      expect(button("Test").disabled).toBe(true);
      await enter(field("Token"), candidate);
      expect(button("Test").disabled).toBe(candidate.trim() === "");
      expect(props.setup.connect).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["krls2020/tst123", "Enter the full address, like github.com/owner/repo."],
    ["github.com/krls2020", "Enter the full address, like github.com/owner/repo."],
    [
      "git@github.com:krls2020/tst123.git",
      "SSH URLs are not supported. Enter an HTTPS repository address.",
    ],
    [
      "ssh://git@github.com/krls2020/tst123",
      "SSH URLs are not supported. Enter an HTTPS repository address.",
    ],
    [
      "https://user:secret@github.com/krls2020/tst123",
      "Enter a repository address without credentials.",
    ],
  ])("an invalid repository address explains what to fix: %s", async (address, sentence) => {
    await draw({ repos: [] });
    await enter(field("Repository"), address);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(sentence);
    expect(host.textContent).not.toContain("GitHub · a token comes next");
    expect(field("Repository").value).toBe(address);
    expect(button("Continue").disabled).toBe(true);
    expect(props.setup.connect).not.toHaveBeenCalled();
  });
  it("an application with no recorded repository starts with a Repository field", async () => {
    await draw({ repos: [] });
    expect(Array.from(host.querySelectorAll("label")).map((label) => label.textContent)).toEqual([
      "Repository",
    ]);
    expect(host.textContent).not.toContain("No code repositories have been recorded yet.");
    await chooseRepository();
    expect(host.textContent).toContain("A token that may write to it");
    expect(field("Token")).toBeDefined();
    expect(button("Continue").disabled).toBe(true);
  });
  it("a production Git environment starts from a repository; a branch is chosen inside that repository.", async () => {
    expect(Array.from(host.querySelectorAll("label")).map((label) => label.textContent)).toEqual([
      "Repository",
    ]);
    await chooseRepository();
    expect(field("Branch").value).toBe("main");
    expect(host.textContent).toContain(remote.url);
    expect(props.setup.preview).toHaveBeenCalledExactlyOnceWith("main");
  });
  it("a connected repository is recognized before its branch is chosen", async () => {
    await enter(field("Repository"), "github.com/acme/shop");
    expect(host.textContent).toContain("github.com/acme/shop is already connected to Shop.");
    await click("Continue");
    expect(field("Branch").value).toBe("main");
    expect(host.textContent).toContain("Mate must be the only one that writes to it");
  });
  it("the first-push sentence precedes Add without a separate review or checkbox", async () => {
    await chooseRepository();
    expect(host.textContent).toContain(
      "The first push changes 23 files on https://github.com/acme/shop main. Mate's copy wins.",
    );
    expect(host.textContent).not.toContain("Review branch");
    expect(host.querySelector('[role="checkbox"]')).toBeNull();
    expect(props.setup.add).not.toHaveBeenCalled();
    expect(button("Add production to Shop").disabled).toBe(false);
    await click("Add production to Shop");
    expect(props.setup.add).toHaveBeenCalledExactlyOnceWith({
      tier: "production",
      name: "shop-production",
      target: { kind: "git", branch: "main", delivery: "direct" },
      adoption: [review],
    });
    expect(props.onAdded).toHaveBeenCalledExactlyOnceWith("shop-production");
  });
  it("changed repository evidence refreshes the first-push sentence before Add", async () => {
    await chooseRepository();
    let finish!: (value: ReadonlyArray<HqGitAdoption>) => void;
    const next = { ...review, mainHead: "d".repeat(40), changedFiles: 7 };
    await draw({
      repos: repositories.map((repo) =>
        repo.name === "app" ? { ...repo, mainHead: next.mainHead } : repo,
      ),
      setup: {
        ...props.setup,
        preview: vi.fn(
          () =>
            new Promise<ReadonlyArray<HqGitAdoption>>((resolve) => {
              finish = resolve;
            }),
        ),
      },
    });
    expect(button("Add production to Shop").disabled).toBe(true);
    expect(host.textContent).not.toContain("changes 23 files");
    await act(async () => finish([next]));
    expect(host.textContent).toContain("changes 7 files");
    expect(button("Add production to Shop").disabled).toBe(false);
    expect(props.setup.add).not.toHaveBeenCalled();
  });
  it("keeps the chosen branch as repository and role authority arrive after first paint", async () => {
    await chooseRepository();
    const branch = field("Branch");
    await enter(branch, "production");
    await draw({ repos: undefined, offered: { add: false, connect: false, replace: false } });
    expect(branch.value).toBe("production");
    await draw({ repos: repositories, offered: { add: true, connect: true, replace: true } });
    await act(async () => branch.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(branch.value).toBe("production");
    expect(props.setup.preview).toHaveBeenLastCalledWith("production");
  });
  it("the token test proves repository access before any branch is chosen", async () => {
    await draw({ repos: [] });
    await chooseRepository();
    await enter(field("Token"), "candidate");
    await click("Test");
    expect(props.setup.connect).toHaveBeenCalledExactlyOnceWith(
      "shop",
      remote.url,
      "candidate",
      false,
    );
    expect(props.setup.preview).not.toHaveBeenCalled();
  });
  it("the chosen branch shows when GitHub's plan enforces no branch rules", async () => {
    await draw({
      setup: {
        ...props.setup,
        preview: vi.fn(async () => [{ ...review, branchRules: "none_on_plan" as const }]),
      },
    });
    await chooseRepository();
    expect(host.textContent).toContain("No branch rules on this plan");
    expect(button("Add production to Shop").disabled).toBe(false);
  });
  it("the branch review lists the token's CI reads, and a missing one never blocks adding the environment", async () => {
    await draw({
      setup: {
        ...props.setup,
        preview: vi.fn(async () => [
          {
            ...review,
            ci: {
              checks: "missing" as const,
              statuses: "granted" as const,
              actions: "unknown" as const,
            },
          },
        ]),
      },
    });
    await chooseRepository();
    const rows = [...host.querySelectorAll('[aria-label="Reads to show CI"] li')].map(
      (row) => row.textContent,
    );
    expect(rows).toEqual([
      "Optional, to show CI:",
      "Checks: Read: missing. Add it to the token on GitHub.",
      "Commit statuses: Read: granted",
      "Actions: Read: Mate couldn't test it.",
    ]);
    expect(button("Add production to Shop").disabled).toBe(false);
  });
  it("a failed candidate probe cannot connect or become an adoption input", async () => {
    await draw({ repos: [] });
    await chooseRepository();
    await enter(field("Token"), "candidate");
    await click("Test");
    expect(props.setup.connect).toHaveBeenCalledExactlyOnceWith(
      "shop",
      remote.url,
      "candidate",
      false,
    );
    expect(field("Token").value).toBe("");
    expect(host.textContent).toContain("This token cannot push.");
    expect(button("Continue").disabled).toBe(true);
    expect(props.setup.preview).not.toHaveBeenCalled();
    expect(props.setup.add).not.toHaveBeenCalled();
  });
  it("a delayed successful connection waits for the owner's repository record", async () => {
    let answer!: (value: { ok: true; remote: typeof remote }) => void;
    const pending = new Promise<{ ok: true; remote: typeof remote }>((resolve) => {
      answer = resolve;
    });
    await draw({ repos: [], setup: { ...props.setup, connect: vi.fn(() => pending) } });
    await chooseRepository();
    expect(host.textContent).toContain(
      "On GitHub, under Repository access choose Only select repositories and pick acme/shop — the link cannot do it for you.",
    );
    expect(host.textContent).toContain("On GitHub, check that it says");
    expect(host.textContent).toContain("Repository access: Only select repositories → acme/shop");
    expect(host.textContent).toContain("Mate keeps it in HQ. Agents and containers never see it.");
    await enter(field("Token"), "candidate");
    await click("Test");
    expect(host.textContent).toContain("Testing the token against acme/shop…");
    await act(async () => answer({ ok: true, remote }));
    expect(button("Continue").disabled).toBe(true);
    await draw({ repos: repositories });
    expect(button("Continue").disabled).toBe(false);
    expect(host.textContent).toContain("Sees acme/shop");
    expect(host.textContent).toContain("Can push to acme/shop");
    expect(host.textContent).toContain(
      "A release that changes .github/workflows needs Workflows: Read and write, which Mate can’t test.",
    );
    expect(host.textContent).not.toContain("Waiting for HQ’s repository record");
    expect(host.textContent?.match(/Expiry not reported/g)).toHaveLength(1);
    await click("Continue");
    expect(field("Branch").value).toBe("main");
  });
  it("A token test shows its expiry as the day the release review shows, never a raw instant", async () => {
    const expiring = { ...remote, expiresAt: "2026-11-14T10:00:00Z" };
    await draw({
      repos: [],
      setup: {
        ...props.setup,
        connect: vi.fn(async () => ({ ok: true as const, remote: expiring })),
      },
    });
    await chooseRepository();
    await enter(field("Token"), "candidate");
    await click("Test");
    await draw({ repos: [{ ...repositories[0]!, remote: expiring }, repositories[1]!] });
    const results = host.querySelector('[aria-label="Token test results"]')!.textContent;
    expect(results).toContain("Token expires 2026-11-14");
    expect(results).not.toContain("T10:00");
    expect(gitRemoteExpiry(expiring, Date.parse("2026-11-10T00:00:00Z"))).toBe(
      "Token expires 2026-11-14",
    );
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
    await chooseRepository();
    await click("Add production to Shop");
    expect(host.textContent).toContain("The remote branch moved. Review again.");
    expect(button("Add production to Shop").disabled).toBe(true);
    expect(host.textContent).not.toContain("changes 23 files");
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
    await chooseRepository();
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
    await chooseRepository();
    expect(host.textContent).toContain(
      "Adoption before attachment pushes nothing to this stage. Its first push follows the next main move.",
    );
    expect(props.setup.add).not.toHaveBeenCalled();
  });
  it("unrelated repository timestamps do not reread the chosen branch", async () => {
    await chooseRepository();
    const preview = props.setup.preview;
    await draw({
      repos: repositories.map((repo) => ({ ...repo, updatedAt: "2026-10-14T10:00:00Z" })),
      setup: { ...props.setup },
    });
    expect(preview).toHaveBeenCalledExactlyOnceWith("main");
    expect(button("Add production to Shop").disabled).toBe(false);
  });
  it("a refused token is replaced on the recorded repository even when its address ends in .git", async () => {
    await draw({
      repos: [
        {
          ...repositories[0]!,
          remote: { ...remote, url: `${remote.url}.git`, invalidSince: "2026-10-14T00:00:00Z" },
        },
      ],
    });
    await chooseRepository();
    await enter(field("Token"), "replacement");
    await click("Test");
    expect(props.setup.connect).toHaveBeenCalledExactlyOnceWith(
      "app",
      remote.url,
      "replacement",
      true,
    );
  });
  it("the GitHub token step shows its owner, repository, permissions and expiry checklist", async () => {
    await draw({ repos: [] });
    await chooseRepository();
    expect(Array.from(host.querySelectorAll("li")).map((node) => node.textContent)).toEqual([
      "Resource owner: acme",
      "Repository access: Only select repositories → acme/shop",
      "Contents, Issues and Webhooks: Read and write",
      "Workflows: Read and write (optional)",
      "Expiration: 366 days",
    ]);
    const link = host.querySelector<HTMLAnchorElement>("a")!;
    expect(link.textContent).toBe("Create the token on GitHub");
    const query = new URL(link.href).searchParams;
    expect(query.get("target_name")).toBe("acme");
    expect(query.get("contents")).toBe("write");
    expect(query.get("workflows")).toBe("write");
    expect(query.get("expires_in")).toBe("366");
    expect(query.get("name")).toBe("Mate Shop");
  });
  it("the token permissions the environment form lists are the ones the token guide lists", async () => {
    await draw({ repos: [] });
    await chooseRepository();
    const guide = gitTokenGuide("https://github.com/acme/shop", "Shop");
    if (guide.kind !== "guide") throw new Error("expected a guide");
    expect(Array.from(host.querySelectorAll("li")).map((node) => node.textContent)).toContain(
      guide.permission,
    );
  });
  it("Enter reads the edited branch before enabling Add", async () => {
    await draw({
      setup: { ...props.setup, preview: vi.fn(async (branch) => [{ ...review, branch }]) },
    });
    await chooseRepository();
    await enter(field("Branch"), "release");
    expect(button("Add production to Shop").disabled).toBe(true);
    await act(async () =>
      field("Branch").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    expect(props.setup.preview).toHaveBeenLastCalledWith("release");
    expect(host.textContent).toContain("https://github.com/acme/shop release. Mate's copy wins.");
    expect(button("Add production to Shop").disabled).toBe(false);
    expect(props.setup.add).not.toHaveBeenCalled();
  });
  it("editing a branch hides its old first-push sentence until that branch is read", async () => {
    await chooseRepository();
    await enter(field("Branch"), "release");
    expect(host.textContent).not.toContain("changes 23 files");
    expect(button("Add production to Shop").disabled).toBe(true);
    await enter(field("Branch"), "main");
    expect(host.textContent).toContain("changes 23 files");
    expect(button("Add production to Shop").disabled).toBe(false);
  });
  it("Back returns to repository without losing the address", async () => {
    await chooseRepository();
    await click("Back");
    expect(field("Repository").value).toBe(remote.url);
  });
});
