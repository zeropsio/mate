// @vitest-environment happy-dom
import type { HqGithubView } from "@t3tools/shared/hqGithub";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  appNameProblem,
  appOwner,
  appRepositories,
  defaultAppName,
  githubReturnLine,
  githubReturnTo,
  githubSection,
  githubStatus,
  postManifest,
} from "./automationSettings.logic";

const CONNECTED: HqGithubView = {
  state: "connected",
  slug: "acme-mate",
  name: "Acme Mate",
  botLogin: "acme-mate[bot]",
  owner: "acme",
  appUrl: "https://github.com/apps/acme-mate",
  installUrl: "https://github.com/apps/acme-mate/installations/new",
  installations: [
    {
      id: 1,
      account: "acme",
      accountType: "Organization",
      repositorySelection: "selected",
      repositories: [
        { fullName: "acme/tea-shop", private: true, defaultBranch: "main" },
        { fullName: "acme/api", private: true, defaultBranch: "main" },
        { fullName: "acme/web", private: false, defaultBranch: "main" },
      ],
      suspended: false,
      manageUrl: "https://github.com/organizations/acme/settings/installations/1",
    },
    {
      id: 2,
      account: "nova",
      accountType: "User",
      repositorySelection: "all",
      repositories: [{ fullName: "nova/notes", private: true, defaultBranch: "main" }],
      suspended: false,
      manageUrl: "https://github.com/settings/installations/2",
    },
    {
      id: 3,
      account: "juno",
      accountType: "Organization",
      repositorySelection: "selected",
      repositories: [{ fullName: "juno/old", private: true, defaultBranch: "main" }],
      suspended: true,
      manageUrl: "https://github.com/organizations/juno/settings/installations/3",
    },
  ],
};
const known = (held: HqGithubView) => ({ state: "known", held, stale: false }) as const;

describe("Settings › Automation's GitHub section", () => {
  it.each([
    {
      case: "an organization with no app",
      setting: known({ state: "none" }),
      admin: true,
      says: "Not connected",
    },
    {
      case: "a member where no app is connected",
      setting: known({ state: "none" }),
      admin: false,
      says: "Not connected · The organization's Owner and Admins connect it.",
    },
    {
      case: "a connected app",
      setting: known(CONNECTED),
      admin: false,
      says: "Connected as acme-mate[bot]",
    },
    {
      case: "an HQ older than the app",
      setting: { state: "unsupported" },
      admin: true,
      says: "Update HQ to connect GitHub",
    },
    {
      case: "a person HQ shows nothing of it",
      setting: { state: "withheld" },
      admin: false,
      says: "Only the organization's Owner and Admins see this.",
    },
    {
      case: "HQ's failure",
      setting: { state: "failed", words: "HQ isn't answering." },
      admin: true,
      says: "HQ isn't answering.",
    },
    { case: "a read under way", setting: { state: "reading" }, admin: true, says: "Reading…" },
  ] as const)("says $case in one line", ({ setting, admin, says }) => {
    expect(githubStatus(githubSection(setting, admin))).toBe(says);
  });

  it("offers making the app only to the organization's Owner and Admins", () => {
    expect(githubSection(known({ state: "none" }), true)).toEqual({ kind: "none", connect: true });
    expect(githubSection(known({ state: "none" }), false)).toEqual({
      kind: "none",
      connect: false,
    });
  });

  it("lists where a connected app is installed, each with its page on GitHub", () => {
    const section = githubSection(known(CONNECTED), true);
    expect(section.kind === "connected" ? section.installations : null).toEqual([
      {
        id: 1,
        line: "acme · 3 repositories",
        manageUrl: "https://github.com/organizations/acme/settings/installations/1",
        suspended: false,
      },
      {
        id: 2,
        line: "nova · all repositories",
        manageUrl: "https://github.com/settings/installations/2",
        suspended: false,
      },
      {
        id: 3,
        line: "juno · suspended",
        manageUrl: "https://github.com/organizations/juno/settings/installations/3",
        suspended: true,
      },
    ]);
    expect(section).toMatchObject({ manage: true });
    expect(githubSection(known(CONNECTED), false)).toMatchObject({ manage: false });
  });
});

describe("making the organization's GitHub app", () => {
  it("names it after the organization, within GitHub's 34 characters", () => {
    expect(defaultAppName("Acme")).toBe("Acme Mate");
    expect(defaultAppName("Tea Shop International Holdings Group")).toHaveLength(34);
    expect(defaultAppName("Tea Shop International Holdings Group")).toMatch(/ Mate$/u);
  });

  it("refuses an empty name or one GitHub would refuse before anything is sent", () => {
    expect(appNameProblem("  ")).toBe("Name the app.");
    expect(appNameProblem("x".repeat(35))).toBe("GitHub takes at most 34 characters.");
    expect(appNameProblem("Acme Mate")).toBeNull();
  });

  it("makes it for the GitHub organization typed, or the person's own account when none is", () => {
    expect(appOwner("")).toBeNull();
    expect(appOwner("acme")).toBe("acme");
    expect(appOwner("https://github.com/acme/")).toBe("acme");
    expect(appOwner("@acme")).toBe("acme");
  });

  it("brings the person back to Settings › Automation, under the bundle's path", () => {
    expect(githubReturnTo("https://acme.example", "/mate")).toBe(
      "https://acme.example/mate/settings/automation?github=connected",
    );
  });

  it("posts HQ's manifest to GitHub's page as a form's manifest field, in this tab", () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    postManifest(document, {
      postUrl: "https://github.com/organizations/acme/settings/apps/new?state=s1",
      manifest: '{"name":"Acme Mate"}',
    });
    const form = document.body.querySelector("form")!;
    expect(form.method.toLowerCase()).toBe("post");
    expect(form.action).toBe("https://github.com/organizations/acme/settings/apps/new?state=s1");
    expect(form.target).toBe("");
    const field = form.querySelector<HTMLInputElement>('input[name="manifest"]')!;
    expect(field.value).toBe('{"name":"Acme Mate"}');
    expect(submit).toHaveBeenCalledTimes(1);
    submit.mockRestore();
  });
});

describe("the repositories the app reaches", () => {
  it("offers each repository of every installation not suspended, once, by name", () => {
    expect(appRepositories(CONNECTED)).toEqual([
      "acme/api",
      "acme/tea-shop",
      "acme/web",
      "nova/notes",
    ]);
    expect(appRepositories({ state: "none" })).toEqual([]);
    expect(appRepositories(null)).toEqual([]);
  });
});

describe("coming back from GitHub", () => {
  it("confirms a connected app, and says an owner's approval is asked where GitHub asked one", () => {
    expect(githubReturnLine("connected", githubSection(known(CONNECTED), true))).toBe(
      "GitHub is connected. Mate acts there as acme-mate[bot] from now on.",
    );
    expect(githubReturnLine("requested", githubSection(known(CONNECTED), true))).toBe(
      "GitHub asked an owner of acme to approve the app; it's installed once they do.",
    );
    expect(githubReturnLine("requested", githubSection(known({ state: "none" }), true))).toBe(
      "GitHub asked an owner of the organization to approve the app; it's installed once they do.",
    );
    expect(githubReturnLine(null, githubSection(known(CONNECTED), true))).toBeNull();
    expect(githubReturnLine("connected", githubSection(known({ state: "none" }), true))).toBeNull();
  });
});

describe("one app on many GitHub accounts", () => {
  const MANY: HqGithubView = {
    ...CONNECTED,
    public: true,
    installations: [
      { ...CONNECTED.installations[0]!, state: "accepted" },
      { ...CONNECTED.installations[1]!, state: "accepted" },
      {
        id: 4,
        account: "stranger",
        accountType: "User",
        repositorySelection: "selected",
        repositories: [
          { fullName: "stranger/notes", private: true, defaultBranch: "main" },
          { fullName: "stranger/site", private: false, defaultBranch: "main" },
        ],
        suspended: false,
        state: "waiting",
        manageUrl: "https://github.com/settings/installations/4",
      },
    ],
  } as HqGithubView;

  it("an app installed on two accounts lists both", () => {
    const section = githubSection(known(MANY), true);
    expect(
      section.kind === "connected" ? section.installations.map(({ line }) => line) : null,
    ).toEqual(["acme · 3 repositories", "nova · all repositories"]);
    expect(appRepositories(MANY)).toEqual(["acme/api", "acme/tea-shop", "acme/web", "nova/notes"]);
  });

  it("an installation not started here waits for an admin's OK and its repositories aren't offered", () => {
    const section = githubSection(known(MANY), false);
    expect(section.kind === "connected" ? section.waiting : null).toEqual([
      {
        id: 4,
        account: "stranger",
        repositories: ["stranger/notes", "stranger/site"],
      },
    ]);
    expect(appRepositories(MANY)).not.toContain("stranger/notes");
  });

  it("an HQ that says nothing of an installation's standing offers it as before, and nothing of the app's reach", () => {
    const section = githubSection(known(CONNECTED), true);
    expect(section).toMatchObject({
      kind: "connected",
      waiting: [],
      privateTo: null,
      installTrip: false,
    });
    expect(githubSection(known(MANY), true)).toMatchObject({ installTrip: true });
    expect(appRepositories(CONNECTED)).toContain("nova/notes");
  });

  it("a private app says it installs only on its owner, with the page that makes it public", () => {
    const owned = (ownerType?: "User" | "Organization") =>
      githubSection(
        known({
          ...MANY,
          public: false,
          ...(ownerType === undefined ? {} : { ownerType }),
        } as HqGithubView),
        true,
      );
    expect(owned("Organization")).toMatchObject({
      privateTo: {
        owner: "acme",
        url: "https://github.com/organizations/acme/settings/apps/acme-mate/advanced",
        settings: true,
      },
    });
    expect(owned("User")).toMatchObject({
      privateTo: { url: "https://github.com/settings/apps/acme-mate/advanced", settings: true },
    });
    // HQ does not say whose: the app's own page, no settings page guessed.
    expect(owned()).toMatchObject({
      privateTo: { url: "https://github.com/apps/acme-mate", settings: false },
    });
    expect(githubSection(known(MANY), true)).toMatchObject({ privateTo: null });
  });

  it("says GitHub's install waits for an OK only while an installation here waits for one", () => {
    expect(githubReturnLine("waiting", githubSection(known(MANY), true))).toBe(
      "GitHub installed the app. It waits for an Owner's or Admin's OK before Mate uses it.",
    );
    // Accepted or suspended since, another organization's, or one with no app: nothing to say.
    expect(githubReturnLine("waiting", githubSection(known(CONNECTED), true))).toBeNull();
    expect(githubReturnLine("waiting", githubSection(known({ state: "none" }), true))).toBeNull();
  });
});
