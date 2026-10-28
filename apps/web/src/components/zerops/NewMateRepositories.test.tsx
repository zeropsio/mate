// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import { NewMateRepositories } from "./NewMateRepositories";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const input = vi.hoisted(() => ({
  repos: ["appdev", "docs"] as string[],
  allowed: true,
  pages: new Map<string, unknown>(),
  asked: [] as Array<unknown>,
}));
vi.mock("~/zerops/useHqAppDetail", () => ({
  useHqAppDetail: (appId: string) => ({
    repos: input.repos.map((name) => ({ name, mainHead: null, updatedAt: "2026-10-28" })),
    appId,
  }),
}));
vi.mock("~/zerops/useChangeOffers", () => ({
  useChangeOffers: () => () => ({ read: input.allowed }),
}));
vi.mock("~/zerops/useGitBrowse", () => ({
  useGitBrowseReads: (
    requests: ReadonlyArray<{ readonly appId: string; readonly repo: string }>,
    allowed: boolean,
  ) => {
    input.asked.push({ requests, allowed });
    return {
      views: requests.map((request) =>
        !allowed
          ? { state: "withheld" }
          : (input.pages.get(`${request.appId}/${request.repo}`) ?? { state: "unread" }),
      ),
    };
  },
}));

const known = (storage: GitHome["about"]["storage"]) => ({
  state: "known",
  answer: { about: { storage } },
});

describe("the repositories a new Mate will work on", () => {
  it("shows each attached repository's HQ storage and updates late metadata without substituting another project's bytes", async () => {
    input.pages.clear();
    input.asked = [];
    input.allowed = true;
    input.repos = ["appdev", "docs"];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<NewMateRepositories appId="shop" />));
    expect(host.textContent?.match(/Git storage is not available yet\./g) ?? []).toHaveLength(2);
    expect(input.asked.at(-1)).toEqual({
      requests: [
        { appId: "shop", repo: "appdev", read: "home", params: { content: "metadata" } },
        { appId: "shop", repo: "docs", read: "home", params: { content: "metadata" } },
      ],
      allowed: true,
    });
    input.pages.set(
      "shop/appdev",
      known({
        usedBytes: 1_300_000_000,
        limitBytes: 2_000_000_000,
        large: true,
        routeBodyLimitBytes: 1_342_177_280,
      }),
    );
    input.pages.set(
      "shop/docs",
      known({
        usedBytes: 12_000_000,
        limitBytes: 2_000_000_000,
        large: false,
        routeBodyLimitBytes: 1_342_177_280,
      }),
    );
    await act(async () => root.render(<NewMateRepositories appId="shop" />));
    expect(host.textContent).toContain("Git storage: 1.30 GB of 2.00 GB");
    expect(host.textContent).toContain("Git storage: 12.00 MB of 2.00 GB");
    expect(host.textContent?.match(/Large repository/g)).toHaveLength(1);
    expect(host.textContent).toContain("Starting a new workspace may take longer.");
    await act(async () => root.render(<NewMateRepositories appId="other" />));
    expect(host.textContent).not.toContain("1.30 GB");
    expect(host.textContent?.match(/Git storage is not available yet\./g) ?? []).toHaveLength(2);
    input.allowed = false;
    await act(async () => root.render(<NewMateRepositories appId="shop" />));
    expect(host.textContent).not.toContain("1.30 GB");
    expect(host.textContent).not.toContain("Large repository");
    await act(async () => root.unmount());
    host.remove();
  });
});
