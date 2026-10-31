// @vitest-environment happy-dom
import * as Schema from "effect/Schema";
import { HqGitNavigationEnvironment as GitEnvironmentSchema } from "@t3tools/shared/hqStream";
import {
  canonicalAppEnvironments,
  environmentById,
  readsOfState,
} from "@t3tools/client-runtime/data";
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import type { HqPushNavigationJob, HqGitNavigationEnvironment } from "@t3tools/shared/hqStream";
import type { HqPushCi } from "@t3tools/shared/hqDeploys";
import type { Release } from "@t3tools/shared/hqRelease";
import { gitDeliveryOf } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  productionChip,
  drawnChip,
  chipFace,
  chipDot,
  productionMenu,
} from "./SidebarProductionChip.logic";
import { placeLines } from "./projects/projectCard.logic";
import { canonicalEnvironmentRow, groupFlow } from "@t3tools/client-runtime/zerops";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ReleaseReviewView } from "./review/ZeropsReleaseReview";
import { GitReleaseRows } from "./ZeropsReleaseRows";
import { flowReleaseOf } from "@t3tools/client-runtime/zerops";
import { AccountDataContext, type AccountData } from "~/zerops/accountData";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { useCompactProjectFlows } from "~/zerops/projectFlows";
import { GitCommitLink, GitDeliveryStatus } from "./GitDeliveryStatus";
const SHA = "a".repeat(40);
const OLD = "b".repeat(40);
const AT = "2026-10-13T10:00:00Z";
const remote = {
  url: "https://github.com/acme/api.git",
  repositoryId: "1",
  keptAt: AT,
  keptBy: "custodian",
  expiresAt: null,
  invalidSince: null,
};
const target = { kind: "git", branch: "main", delivery: "direct" } as const;
const attachment = { environmentId: HqEnvironmentId.make("git-prod"), createdAt: AT, target };
const release = (tag = "v2.0.0", sha = SHA): Release => ({
  tag,
  sha,
  entries: [
    { service: "api", sha },
    { service: "web", sha },
  ],
  target: "git",
  releaseTarget: attachment,
  by: "releaser",
  at: AT,
  state: "approved",
  reason: null,
  rollbackOf: null,
});
function job(
  state: HqPushNavigationJob["state"],
  repo = "api",
  tag = "v2.0.0",
  sha = SHA,
): HqPushNavigationJob {
  const attempt = {
    remote: repo === "web" ? { ...remote, url: "https://gitlab.com/acme/web.git" } : remote,
    ref: "refs/heads/main",
    sha,
    before: OLD,
    credentialKeptAt: AT,
    phase: "submitting",
  } as const;
  return {
    id: `${tag}/${repo}/${state}`,
    kind: "push",
    service: repo,
    sha,
    state,
    cause: "release",
    ref: tag,
    reason: state === "refused" ? "credential" : null,
    appVersionId: null,
    processId: null,
    requestedBy: "releaser",
    at: AT,
    endedAt: state === "queued" || state === "submitting" ? null : AT,
    supersededBy: null,
    evidence: {
      attempt,
      ...(state === "pushed"
        ? {
            confirmed: {
              remote: attempt.remote,
              ref: attempt.ref,
              before: OLD,
              after: sha,
              at: AT,
              via: "answer" as const,
            },
          }
        : {}),
      nextActor:
        state === "unresolved" || state === "refused"
          ? "person"
          : state === "queued" || state === "submitting"
            ? "hq"
            : "none",
      nextAction: state === "refused" ? "Replace token" : "Check main on github.com",
    },
  };
}
const environment = (jobs: ReadonlyArray<HqPushNavigationJob>): HqGitNavigationEnvironment => ({
  id: attachment.environmentId,
  target,
  tier: "production",
  jobs,
  name: "Production",
  sources: ["release"],
  order: 1,
  keyHeld: false,
  keyInvalid: false,
  can: {},
  birth: null,
  release: {
    id: "rollout-2",
    target: "git",
    releaseTarget: attachment,
    tag: "v2.0.0",
    planned: true,
    ended: true,
    endedAt: AT,
    landed: false,
    leftOut: [],
  },
});
const repos = [
  { name: "api", appId: "shop", mainHead: SHA, updatedAt: AT, remote },
  {
    name: "web",
    appId: "shop",
    mainHead: SHA,
    updatedAt: AT,
    remote: { ...remote, url: "https://gitlab.com/acme/web.git" },
  },
];
describe("Git hand-over evidence", () => {
  it.each(["pushed", "refused", "unresolved", "queued", "submitting"] as const)(
    "renders the shared %s standing after source records arrive",
    (state) => {
      const env = environment([job(state), job(state, "web")]);
      const delivery = gitDeliveryOf(env, { releases: [release()], repos });
      const before = renderToStaticMarkup(<GitDeliveryStatus environment={env} repos={repos} />);
      expect(before).toContain("Checking what HQ pushed");
      const html = renderToStaticMarkup(
        <GitDeliveryStatus environment={env} repos={repos} delivery={delivery} />,
      );
      expect(html).toContain(delivery!.line.replaceAll("'", "&#x27;"));
      expect(html).toContain("Moves on release · pushes to github.com/acme/api main");
      expect(html.match(/Expiry not reported/g)).toHaveLength(2);
      expect(html).not.toMatch(/Healthy|Running|Open in Zerops|Roll back|Ask .* to fix|No expiry/);
      if (state === "pushed") {
        expect(html).toContain(`https://github.com/acme/api/commit/${SHA}`);
        expect(html).toContain(`https://gitlab.com/acme/web/-/commit/${SHA}`);
      } else expect(html).not.toContain("/commit/");
    },
  );
  it("names partly pushed repositories and keeps the previous hand-over separate", () => {
    const env = environment([
      job("pushed"),
      job("refused", "web"),
      job("pushed", "api", "v1.0.0", OLD),
      job("pushed", "web", "v1.0.0", OLD),
    ]);
    const delivery = gitDeliveryOf(env, { releases: [release(), release("v1.0.0", OLD)], repos });
    const html = renderToStaticMarkup(
      <GitDeliveryStatus environment={env} repos={repos} delivery={delivery} />,
    );
    expect(html).toContain("Pushed 1 of 2: web: credential");
    expect(html).toContain("Previous hand-over: v1.0.0");
    expect(html).toContain(`https://github.com/acme/api/commit/${SHA}`);
    expect(html).not.toContain(`https://gitlab.com/acme/web/-/commit/${SHA}`);
  });
  it("preserves last-known standing and repository omission without claiming all were pushed", () => {
    const env = environment([job("pushed")]);
    const omitted = {
      ...env,
      release: {
        ...env.release!,
        leftOut: [{ service: "web", sha: SHA, job: null, reason: "No remote connected" }],
      },
    };
    const delivery = gitDeliveryOf(omitted, { releases: [release()], repos, live: false });
    const html = renderToStaticMarkup(
      <GitDeliveryStatus environment={omitted} repos={repos} delivery={delivery} />,
    );
    expect(html).toContain("Last known · Pushed 1 of 2: web: No remote connected");
    expect(html).toContain("No remote connected");
  });
});

it.each(["pushed", "refused", "unresolved", "queued", "submitting"] as const)(
  "menu and card consume the same %s Git standing",
  (state) => {
    const env = environment([job(state), job(state, "web")]);
    const delivery = gitDeliveryOf(env, { releases: [release()], repos })!;
    const row = canonicalEnvironmentRow({
      ...env,
      sources: "release",
      services: [],
      git: delivery,
    });
    const stop = {
      projectId: env.id,
      name: "Production",
      tier: "production" as const,
      row,
      deployment: undefined,
      addresses: [],
    };
    const flow = groupFlow({
      groupId: "shop",
      mates: [],
      stops: [stop],
      pending: [],
      pullRequests: [],
      merged: [],
      release: {
        gate: { allowed: false, reason: "fixture" },
        suggestion: "v3.0.0",
        waiting: 0,
        waitingAtLeast: false,
        untold: [],
      },
      mainHasCode: undefined,
      mainHead: undefined,
    });
    const chip = drawnChip(
      productionChip({
        production: flow.production,
        building: undefined,
        waiting: 0,
        waitingAtLeast: false,
        untold: [],
        serving: { kind: "down", services: ["must not read"] },
        releases: { kind: "answered", failure: undefined },
      }),
    );
    expect(chip).toBeDefined();
    expect(chipFace(chip!).words).toBe(delivery.line);
    expect(chipDot(chip!)).not.toBe("ok");
    const menu = productionMenu({
      chip: chip!,
      projectId: undefined,
      failure: undefined,
      down: [],
      routes: [],
      nowMs: Date.parse(AT),
    });
    expect(menu.stops[0]?.word).toBe(delivery.line);
    expect(menu.stops[0]?.fix).toBeUndefined();
    const lines = placeLines({ flow, nowMs: Date.parse(AT) });
    expect(lines[0]?.words).toContain(delivery.line);
  },
);

it("Git evidence replaces the first paint when source records arrive", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const env = environment([job("pushed"), job("pushed", "web")]);
  try {
    await act(async () => root.render(<GitDeliveryStatus environment={env} />));
    expect(container.textContent).toContain("Checking what HQ pushed");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    const delivery = gitDeliveryOf(env, { releases: [release()], repos });
    await act(async () =>
      root.render(<GitDeliveryStatus environment={env} repos={repos} delivery={delivery} />),
    );
    expect(container.textContent).toContain("Pushed v2.0.0");
    expect(container.textContent?.match(/Expiry not reported/g)).toHaveLength(2);
    expect([...container.querySelectorAll("a")].map((link) => link.href)).toEqual([
      `https://github.com/acme/api/commit/${SHA}`,
      `https://gitlab.com/acme/web/-/commit/${SHA}`,
    ]);
  } finally {
    await act(async () => root.unmount());
  }
});
it("a refused token review offers Cancel and Replace token without Release", () => {
  const reason = "credential";
  const env = environment([job("refused"), job("refused", "web")]);
  const delivery = gitDeliveryOf(env, {
    releases: [release()],
    repos: repos.map((repo) => ({ ...repo, remote: { ...repo.remote, invalidSince: AT } })),
  })!;
  const html = renderToStaticMarkup(
    <ReleaseReviewView
      name="Shop"
      git={{
        attachment,
        delivery,
        replaceTokenPermission: { allowed: true },
        repositories: repos.map((repo) => ({
          repository: repo.name,
          sha: repo.mainHead,
          remote: repo.remote,
          included: true,
          reason: undefined,
        })),
      }}
      tag="v3.0.0"
      gate={{ allowed: false, reason }}
      permission={{ allowed: true }}
      rows={[]}
      untold={["must not read"]}
      where={[{ service: "must not read", line: "deploys" }]}
      hasStage={false}
      services={[]}
      replaces={{ kind: "release", tag: "v1.0.0" }}
      outcome={{ kind: "offered" }}
      press={{ kind: "idle" }}
      fixer="Mate"
      now={Date.parse(AT)}
      onRelease={() => {
        throw new Error("Must not release");
      }}
      onReplaceToken={() => {}}
      onClose={() => {}}
      onFix={() => {
        throw new Error("No platform fix");
      }}
    />,
  );
  expect(html).toContain("Cancel");
  expect(html).toContain("Replace token");
  expect(html).not.toMatch(/Release v3.0.0<|Roll back|Ask Mate|must not read|Production now/);
  expect(html.match(/Expiry not reported/g)).toHaveLength(2);
});
it("Git release history shows frozen commits and keeps previous push distinct from current refusal", () => {
  const env = environment([
    job("refused"),
    job("refused", "web"),
    job("pushed", "api", "v1.0.0", OLD),
    job("pushed", "web", "v1.0.0", OLD),
  ]);
  const records = [release(), release("v1.0.0", OLD)];
  const delivery = gitDeliveryOf(env, { releases: records, repos });
  const html = renderToStaticMarkup(
    <ul>
      <GitReleaseRows releases={records.map(flowReleaseOf)} delivery={delivery} jobs={env.jobs} />
    </ul>,
  );
  expect(html).toContain(delivery!.line.replaceAll("'", "&#x27;"));
  expect(html).toContain("Previously pushed v1.0.0");
  expect(html).toContain("api aaaaaaa");
  expect(html).toContain("api bbbbbbb");
  expect(html).not.toMatch(/Roll back|Live|Running|<button/);
});

it("a production with no accepted release says Not released yet", () => {
  const env = { ...environment([]), release: null };
  const delivery = gitDeliveryOf(env, { releases: [], repos })!;
  const html = renderToStaticMarkup(
    <GitDeliveryStatus environment={env} repos={repos} delivery={delivery} />,
  );
  expect(delivery.standing).toBe("not-released");
  expect(html).toContain("Not released yet");
  expect(html).not.toMatch(/Previously pushed|\/commit\/|Running|Healthy/);
});
it("a recovering writer keeps its shared outstanding hand-over until HQ confirms it", () => {
  const submitting = job("submitting");
  const recovering = {
    ...submitting,
    evidence: {
      ...submitting.evidence!,
      attempt: { ...submitting.evidence!.attempt!, phase: "recovering" as const },
    },
  };
  const env = environment([recovering, job("queued", "web")]);
  const delivery = gitDeliveryOf(env, { releases: [release()], repos })!;
  const html = renderToStaticMarkup(
    <GitDeliveryStatus environment={env} repos={repos} delivery={delivery} />,
  );
  expect(delivery.standing).toBe("pushing");
  expect(delivery.release.allowed).toBe(false);
  expect(html).toContain(delivery.line);
  expect(html).not.toContain("/commit/");
});
it("divergence is shown as branch evidence and never called a refused token", () => {
  const env = environment([
    { ...job("refused"), reason: "diverged" },
    { ...job("refused", "web"), reason: "diverged" },
  ]);
  const delivery = gitDeliveryOf(env, { releases: [release()], repos })!;
  const html = renderToStaticMarkup(
    <GitDeliveryStatus environment={env} repos={repos} delivery={delivery} />,
  );
  expect(delivery.release.allowed).toBe(false);
  expect(delivery.release.reason).toContain("remote branch has commits Mate doesn't");
  expect(html).toContain("diverged");
  expect(html).not.toContain("The remote refused Mate&#x27;s token");
});
it("confirmed host links keep the receipt address and sha after remote metadata changes", () => {
  const env = environment([job("pushed"), job("pushed", "web")]);
  const moved = repos.map((repo) => ({
    ...repo,
    remote: { ...repo.remote, url: "https://github.com/new/address.git" },
  }));
  const delivery = gitDeliveryOf(env, { releases: [release()], repos: moved })!;
  const html = renderToStaticMarkup(
    <GitDeliveryStatus environment={env} repos={moved} delivery={delivery} />,
  );
  expect(html).toContain(`https://github.com/acme/api/commit/${SHA}`);
  expect(html).not.toContain(`https://github.com/new/address/commit/${SHA}`);
});
it("an unsupported host never receives an invented commit link", () => {
  expect(
    renderToStaticMarkup(<GitCommitLink remote="https://forge.example/acme/app.git" sha={SHA} />),
  ).toBe("");
});

vi.mock("~/zerops/ZeropsSessionProvider", async (original) => ({
  ...(await original<typeof import("~/zerops/ZeropsSessionProvider")>()),
  useZeropsSession: () => ({ status: "signed-in", activeOrganization: { id: "org" } }),
}));
vi.mock("~/zerops/accountHq", () => ({
  configuredHq: () => ({ projectId: "hq", address: "https://hq.test" }),
}));
it("the mounted compact flow joins delayed navigation evidence before menus and details read it", async () => {
  const registry = AtomRegistry.make();
  const initial = environment([]);
  const zerops = {
    ...initial,
    id: HqEnvironmentId.make("zerops-stage"),
    tier: "stage" as const,
    target: { kind: "zerops" as const, projectId: ProjectId.make("real-stage") },
    jobs: [],
    order: 2,
  };
  const { store } = mountHqNavigation(registry, "org", {
    structure: {
      apps: [
        {
          id: "shop",
          name: "Shop",
          projects: [],
          environments: [{ ...initial, jobs: [] }, zerops],
        },
      ],
      ungrouped: [],
    },
  });
  const account: Pick<AccountData, "data" | "orgId" | "demandDetail"> = {
    data: store.data,
    orgId: "org",
    demandDetail: () => () => {},
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  function Consumer() {
    const { flows } = useCompactProjectFlows(["shop"]);
    const row = flows.get("shop")?.environments.find((entry) => entry.target.kind === "git");
    return row?.target.kind !== "git" ? null : (
      <GitDeliveryStatus environment={{ target: row.target, tier: row.tier }} delivery={row.git} />
    );
  }
  await act(async () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <AccountDataContext.Provider value={account as AccountData}>
          <Consumer />
        </AccountDataContext.Provider>
      </RegistryContext.Provider>,
    ),
  );
  expect(host.textContent).toContain("Checking what HQ pushed");
  const admitted = Schema.decodeSync(GitEnvironmentSchema)(
    environment([job("queued"), job("queued", "web")]),
  );
  const app = readsOfState(store.state()).fact("hqApp", "shop");
  if (app.kind !== "known") throw new Error("Source app must already be admitted");
  await act(async () =>
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      reset: false,
      scopes: [
        {
          scope: "hq:org:hq-apps",
          generation: store.state().streams.get("hq:org:hq-apps")!.generation,
        },
      ],
      rows: [
        {
          family: "hqApp",
          id: "shop",
          revision: { kind: "hq", incarnation: "seed", revision: 10000 },
          value: { ...app.value, environments: [admitted, zerops] },
        },
      ],
      removals: [],
    }),
  );
  const stored = readsOfState(store.state()).fact("hqApp", "shop");
  expect(
    stored.kind === "known" &&
      Array.isArray(stored.value.environments) &&
      stored.value.environments[0]?.jobs[0]?.state,
  ).toBe("queued");
  const reads = readsOfState(store.state());
  expect(
    canonicalAppEnvironments
      .derive(reads, { orgId: "org", appId: "shop" })
      .environments?.flatMap((entry) =>
        entry.target.kind === "zerops" ? [entry.target.projectId] : [],
      ),
  ).toEqual(["real-stage"]);
  expect(
    environmentById.derive(reads, { orgId: "org", appId: "shop", id: admitted.id })?.jobs[0]?.state,
  ).toBe("queued");
  expect(host.textContent).toContain("Pushing v2.0.0…");
  expect(host.querySelector("[data-standing]")?.getAttribute("data-standing")).toBe("pushing");
  await act(async () => root.unmount());
  registry.dispose();
});

const ci = (record: Partial<HqPushCi>): HqPushCi => ({
  sha: SHA,
  verdict: "running",
  done: 0,
  total: 0,
  failed: [],
  required: null,
  reason: null,
  watch: "watching",
  readAt: AT,
  until: "2026-10-13T11:00:00Z",
  ...record,
});
const withCi = (pushed: HqPushNavigationJob, record: HqPushCi): HqPushNavigationJob => ({
  ...pushed,
  evidence: { ...pushed.evidence!, ci: record },
});
const ciLines = (record: HqPushCi) => {
  const env = environment([withCi(job("pushed"), record), job("pushed", "web")]);
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <GitDeliveryStatus
      environment={env}
      repos={repos}
      delivery={gitDeliveryOf(env, { releases: [release()], repos })}
    />,
  );
  return [...host.querySelectorAll("[data-git-ci]")].map((line) => ({
    words: line.textContent,
    links: [...line.querySelectorAll("a")].map((link) => [link.textContent, link.href]),
  }));
};
describe("the origin's CI on a Git environment's last push", () => {
  it.each([
    [
      "a push whose CI still runs says how many of its checks are done",
      ci({ verdict: "running", done: 12, total: 14 }),
      "CI running · 12 of 14 done",
    ],
    [
      "a push whose CI passed says CI passed",
      ci({ verdict: "passed", done: 14, total: 14, watch: "finished" }),
      "CI passed",
    ],
    [
      "a push no CI reported on says No CI reported",
      ci({ verdict: "none", watch: "finished" }),
      "No CI reported",
    ],
    [
      "a push whose CI has not reported yet says so",
      ci({ verdict: "none" }),
      "CI not reported yet",
    ],
    [
      "a push whose CI HQ cannot read says why",
      ci({
        verdict: "unreadable",
        watch: "stopped",
        reason: "The token can't read check runs. Add Checks: Read to the token to show CI.",
      }),
      "CI unreadable: The token can't read check runs. Add Checks: Read to the token to show CI.",
    ],
    [
      "a push HQ stopped watching keeps its last count and says why it stopped",
      ci({
        verdict: "running",
        done: 3,
        total: 4,
        watch: "stopped",
        reason: "Mate stopped watching CI 60 minutes after the push.",
      }),
      "CI running · 3 of 4 done · Mate stopped watching CI 60 minutes after the push.",
    ],
  ] as const)("%s", (_title, record, words) => {
    expect(ciLines(record)).toEqual([{ words, links: [] }]);
  });
  it("a push whose CI failed names each failed check and links its run", () => {
    expect(
      ciLines(
        ci({
          verdict: "failed",
          done: 13,
          total: 14,
          failed: [
            { name: "check_types", url: "https://github.com/acme/api/runs/1" },
            { name: "lint", url: null },
          ],
        }),
      ),
    ).toEqual([
      {
        words: "CI failed: check_types, lint · 13 of 14 done",
        links: [["check_types", "https://github.com/acme/api/runs/1"]],
      },
    ]);
  });
  it("a release waiting on stage's check says so, and its refusal links the failed check", () => {
    const lines = (state: "submitting" | "refused", gate: HqPushCi) => {
      const waiting = job(state);
      const env = environment([
        { ...waiting, evidence: { ...waiting.evidence!, gate } },
        job("pushed", "web"),
      ]);
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        <GitDeliveryStatus
          environment={env}
          repos={repos}
          delivery={gitDeliveryOf(env, { releases: [release()], repos })}
        />,
      );
      return [...host.querySelectorAll("[data-git-ci]")].map((line) => ({
        words: line.textContent,
        links: [...line.querySelectorAll("a")].map((link) => [link.textContent, link.href]),
      }));
    };
    expect(
      lines("submitting", ci({ verdict: "running", done: 0, total: 1, required: ["check"] })),
    ).toEqual([{ words: 'Stage CI "check" running · 0 of 1 done', links: [] }]);
    expect(
      lines(
        "refused",
        ci({
          verdict: "failed",
          done: 1,
          total: 1,
          watch: "finished",
          required: ["check"],
          failed: [{ name: "check", url: "https://github.com/acme/api/actions/runs/9" }],
        }),
      ),
    ).toEqual([
      {
        words: 'Stage CI "check" failed: check',
        links: [["check", "https://github.com/acme/api/actions/runs/9"]],
      },
    ]);
    expect(
      lines("refused", ci({ verdict: "none", watch: "finished", required: ["check"] })),
    ).toEqual([{ words: 'Stage CI "check" never ran', links: [] }]);
  });
  it("a release names the required checks stage never ran, and says when stage reported no CI", () => {
    const lines = (gate: HqPushCi) => {
      const refused = job("refused");
      const env = environment([
        { ...refused, evidence: { ...refused.evidence!, gate } },
        job("pushed", "web"),
      ]);
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        <GitDeliveryStatus
          environment={env}
          repos={repos}
          delivery={gitDeliveryOf(env, { releases: [release()], repos })}
        />,
      );
      return [...host.querySelectorAll("[data-git-ci]")].map((line) => line.textContent);
    };
    expect(
      lines(
        ci({
          verdict: "running",
          done: 1,
          total: 2,
          watch: "finished",
          required: ["Check", "Test"],
          missing: ["Test"],
        }),
      ),
    ).toEqual(['Stage CI "Test" never ran']);
    expect(lines(ci({ verdict: "none", watch: "finished", required: null }))).toEqual([
      "No CI reported",
    ]);
  });
  it("a push HQ does not read CI for shows no CI line", () => {
    const env = environment([job("pushed"), job("pushed", "web")]);
    const html = renderToStaticMarkup(
      <GitDeliveryStatus
        environment={env}
        repos={repos}
        delivery={gitDeliveryOf(env, { releases: [release()], repos })}
      />,
    );
    expect(html).not.toContain("data-git-ci");
  });
  it("the CI line follows HQ's rewritten push record as it arrives", async () => {
    const registry = AtomRegistry.make();
    const zerops = {
      ...environment([]),
      id: HqEnvironmentId.make("zerops-stage"),
      tier: "stage" as const,
      target: { kind: "zerops" as const, projectId: ProjectId.make("real-stage") },
      jobs: [],
      order: 2,
    };
    const { store } = mountHqNavigation(registry, "org", {
      structure: {
        apps: [
          {
            id: "shop",
            name: "Shop",
            projects: [],
            environments: [{ ...environment([]), jobs: [] }, zerops],
          },
        ],
        ungrouped: [],
      },
    });
    const app = readsOfState(store.state()).fact("hqApp", "shop");
    if (app.kind !== "known") throw new Error("Source app must already be admitted");
    let revision = 10000;
    const hqWrites = (record: HqPushCi) =>
      store.dispatch({
        kind: "delivery",
        via: "hq-stream",
        reset: false,
        scopes: [
          {
            scope: "hq:org:hq-apps",
            generation: store.state().streams.get("hq:org:hq-apps")!.generation,
          },
        ],
        rows: [
          {
            family: "hqApp",
            id: "shop",
            revision: { kind: "hq", incarnation: "seed", revision: revision++ },
            value: {
              ...app.value,
              environments: [
                Schema.decodeSync(GitEnvironmentSchema)(
                  environment([withCi(job("pushed"), record), job("pushed", "web")]),
                ),
                zerops,
              ],
            },
          },
        ],
        removals: [],
      });
    const host = document.createElement("div");
    const root = createRoot(host);
    const show = () => {
      const env = environmentById.derive(readsOfState(store.state()), {
        orgId: "org",
        appId: "shop",
        id: attachment.environmentId,
      });
      if (env?.target.kind !== "git") throw new Error("The Git environment must be admitted");
      return root.render(
        <GitDeliveryStatus
          environment={{ target: env.target, tier: env.tier }}
          delivery={gitDeliveryOf(env, { releases: [release()], repos })}
        />,
      );
    };
    const words = () => [...host.querySelectorAll("[data-git-ci]")].map((line) => line.textContent);
    hqWrites(ci({ verdict: "running", done: 1, total: 2 }));
    await act(async () => show());
    expect(words()).toEqual(["CI running · 1 of 2 done"]);
    hqWrites(ci({ verdict: "passed", done: 2, total: 2, watch: "finished" }));
    await act(async () => show());
    expect(words()).toEqual(["CI passed"]);
    await act(async () => root.unmount());
    registry.dispose();
  });
});
