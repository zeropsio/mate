// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { gitDeliveryOf } from "@t3tools/client-runtime/zerops";
import type { HqPushCi } from "@t3tools/shared/hqDeploys";
import type { HqPushNavigationJob } from "@t3tools/shared/hqStream";
import { HqEnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { GitStopDetail } from "./GitStopDetail";
const environment = {
  id: HqEnvironmentId.make("git-bookmark"),
  name: "Production",
  tier: "production" as const,
  target: { kind: "git" as const, branch: "main", delivery: "direct" as const },
  jobs: [],
};
const repos = [
  {
    name: "web",
    mainHead: null,
    updatedAt: "2026-10-14T10:00:00Z",
    remote: {
      url: "https://github.com/acme/shop.git",
      repositoryId: "123",
      keptAt: "2026-10-14T10:00:00Z",
      keptBy: "ada",
      expiresAt: null,
      invalidSince: null,
    },
  },
];

describe("Git environment detail", () => {
  it("A branch production offers no roll back.", () => {
    const html = renderToStaticMarkup(<GitStopDetail environment={environment} />);
    expect(html).toContain("Checking what HQ pushed");
    expect(html).not.toMatch(
      /Roll back|Healthy|Down|Coming up|Services|Vault|Open in Zerops|Ask .* to fix/,
    );
  });
  it("An environment's id never opens a Zerops project.", () => {
    const html = renderToStaticMarkup(<GitStopDetail environment={environment} />);
    expect(html).not.toContain("git-bookmark");
    expect(html).not.toMatch(/console.zerops|project\/|routes|Public access/);
  });
  it("absent removal offers cannot invoke an environment endpoint", () => {
    const remove = vi.fn();
    const html = renderToStaticMarkup(
      <GitStopDetail environment={environment} onRemove={remove} />,
    );
    expect(html).not.toContain("Remove environment");
    expect(remove).not.toHaveBeenCalled();
  });
  it("a production with a stage says how to protect main on GitHub and links its rulesets", () => {
    const guide = (staged: boolean, tier: "production" | "stage" = "production") => {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        <GitStopDetail environment={{ ...environment, tier }} repos={repos} staged={staged} />,
      );
      return [...host.querySelectorAll("[data-git-ruleset]")].map((line) => ({
        words: line.textContent,
        links: [...line.querySelectorAll("a")].map((link) => link.href),
      }));
    };
    expect(guide(true)).toEqual([
      {
        words:
          "Protect main on GitHub so only a commit stage tested lands there: add a ruleset on main that requires the CI checks that must pass, blocks force pushes and restricts deletions. Open web's rulesets",
        links: ["https://github.com/acme/shop/settings/rules"],
      },
    ]);
    expect(guide(false)).toEqual([]);
    expect(guide(true, "stage")).toEqual([]);
  });
  it("the sheet shows which checks main's rules required when HQ last read them, or that main is unprotected", () => {
    const said = (record: Pick<HqPushCi, "verdict" | "required">, on: "ci" | "gate") => {
      const ci: HqPushCi = {
        sha: "a".repeat(40),
        done: 0,
        total: 0,
        failed: [],
        reason: null,
        watch: "finished",
        readAt: "2026-10-14T10:00:00Z",
        until: "2026-10-14T11:00:00Z",
        ...record,
      };
      const job: HqPushNavigationJob = {
        id: "v1/web/refused",
        kind: "push",
        service: "web",
        sha: ci.sha,
        state: "refused",
        cause: "release",
        ref: "v1",
        reason: "refused",
        appVersionId: null,
        processId: null,
        requestedBy: "ada",
        at: "2026-10-14T10:00:00Z",
        endedAt: "2026-10-14T10:05:00Z",
        supersededBy: null,
        evidence: {
          attempt: {
            remote: { url: "https://github.com/acme/shop.git", repositoryId: "123" },
            ref: "refs/heads/main",
            sha: ci.sha,
            before: null,
            credentialKeptAt: "2026-10-14T10:00:00Z",
            phase: "closed",
          },
          [on]: ci,
          nextActor: "person",
          nextAction: "refused",
        },
      };
      const env = { ...environment, jobs: [job] };
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        <GitStopDetail environment={env} repos={repos} staged />,
      );
      return host.querySelector("[data-git-ruleset]")?.textContent;
    };
    const guide =
      "Protect main on GitHub so only a commit stage tested lands there: add a ruleset on main that requires the CI checks that must pass, blocks force pushes and restricts deletions.";
    expect(said({ verdict: "passed", required: ["Check", "Test"] }, "ci")).toBe(
      `${guide} As HQ last read them, main's rules require "Check", "Test". Open web's rulesets`,
    );
    expect(said({ verdict: "failed", required: null }, "gate")).toBe(
      `${guide} As HQ last read them, main's rules require no checks: main is unprotected, so a release waits on every GitHub Actions check of stage's commit. Open web's rulesets`,
    );
    expect(said({ verdict: "unreadable", required: null }, "gate")).toBe(
      `${guide} Open web's rulesets`,
    );
  });
  it("PR-only steer is informational until pull-request delivery exists", () => {
    const html = renderToStaticMarkup(
      <GitStopDetail
        environment={{ ...environment, target: { ...environment.target, delivery: "pr" } }}
      />,
    );
    expect(html).toContain("Pull-request delivery is not available here yet");
    expect(html).not.toContain("<button");
  });
});

it("removal preserves unknown external leftovers and Cancel leaves the environment intact", async () => {
  const remove = vi.fn(async () => {});
  const host = document.createElement("div");
  const root = createRoot(host);
  const delivery = gitDeliveryOf(environment, { releases: [], repos: [] });
  await act(async () =>
    root.render(
      <GitStopDetail
        environment={environment}
        delivery={delivery}
        repos={repos}
        can={{ remove_git_environment: { allow: true } }}
        onRemove={remove}
      />,
    ),
  );
  const click = async (label: string) => {
    await act(async () =>
      [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click(),
    );
  };
  await click("Remove environment");
  expect(host.textContent).toContain("never deletes an external branch or undoes a push");
  expect(host.textContent).toContain("token stays valid at its host");
  expect(host.textContent).toContain("External leftovers could not be confirmed");
  await click("Cancel");
  expect(remove).not.toHaveBeenCalled();
  await click("Remove environment");
  await click("Confirm removal");
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it("unresolved removal requires an explicit history-loss confirmation before the account intent", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const remove = vi.fn(async () => {});
  const projected = gitDeliveryOf(environment, { releases: [], repos: [] });
  if (projected === undefined) throw new Error("The Git fixture must project a Git delivery");
  const delivery = { ...projected, standing: "unresolved" as const };
  try {
    await act(async () =>
      root.render(
        <GitStopDetail
          environment={environment}
          delivery={delivery}
          repos={repos}
          can={{ remove_git_environment: { allow: true } }}
          onRemove={remove}
        />,
      ),
    );
    const button = (label: string) =>
      [...host.querySelectorAll("button")].find((node) => node.textContent === label)!;
    await act(async () => button("Remove environment").click());
    expect(button("Confirm removal").disabled).toBe(true);
    await act(async () => button("Confirm removal").click());
    expect(remove).not.toHaveBeenCalled();
    await act(async () => (host.querySelector('[role="checkbox"]') as HTMLButtonElement).click());
    expect(button("Confirm removal").disabled).toBe(false);
    await act(async () => button("Confirm removal").click());
    expect(remove).toHaveBeenCalledWith(true);
  } finally {
    await act(async () => root.unmount());
  }
});

it("Removing Git production names the branch that stays and keeps its remote connected", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const remove = vi.fn(async () => {});
  try {
    await act(async () =>
      root.render(
        <GitStopDetail
          environment={environment}
          repos={repos}
          can={{ remove_git_environment: { allow: true } }}
          onRemove={remove}
        />,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "Remove environment")!
        .click(),
    );
    expect(host.textContent).toContain(
      "Removes production. github.com/acme/shop main stays as it is; Mate stops pushing to it.",
    );
    expect(host.textContent).toContain(
      "The remote stays connected. Manage it under Repositories on this project's page.",
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "Confirm removal")!
        .click(),
    );
    expect(remove).toHaveBeenCalledExactlyOnceWith(undefined);
  } finally {
    await act(async () => root.unmount());
  }
});

it("Production removal waits for the repository address it will name", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const remove = vi.fn(async () => {});
  try {
    await act(async () =>
      root.render(
        <GitStopDetail
          environment={environment}
          can={{ remove_git_environment: { allow: true } }}
          onRemove={remove}
        />,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "Remove environment")!
        .click(),
    );
    const confirm = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Confirm removal",
    )!;
    expect(confirm.disabled).toBe(true);
    expect(host.textContent).toContain("Read the repository addresses before confirming removal.");
    await act(async () => confirm.click());
    expect(remove).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
