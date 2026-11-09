// @vitest-environment happy-dom
import { HqGithubView } from "@t3tools/shared/hqGithub";
import { HqDiscordView, HqSlackView } from "@t3tools/shared/hqIntake";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  appNameProblem,
  appOwner,
  appRepositories,
  connectedByLine,
  defaultAppName,
  githubReturnLine,
  appSetUpWords,
  githubReturnTo,
  githubSection,
  githubStatus,
  postManifest,
  unansweredInstallations,
} from "./automationSettings.logic";
import { recorded } from "@t3tools/test-recordings/recorded";

const repo = (id: number, fullName: string, isPrivate = true) => ({
  id,
  fullName,
  private: isPrivate,
  defaultBranch: "main",
  usedBy: null,
});
const ACME = {
  appId: 1,
  slug: "acme-mate",
  name: "Acme Mate",
  botLogin: "acme-mate[bot]",
  owner: "acme",
  appUrl: "https://github.com/apps/acme-mate",
  installUrl: "https://github.com/apps/acme-mate/installations/new",
  public: true,
  sealedBy: "u-ada",
  sealedAt: "2026-11-07T14:11:01.000Z",
  installations: [
    {
      id: 1,
      account: "acme",
      accountType: "Organization",
      repositorySelection: "selected",
      repositories: [repo(11, "acme/tea-shop"), repo(12, "acme/api"), repo(13, "acme/web", false)],
      suspended: false,
      state: "accepted",
      manageUrl: "https://github.com/organizations/acme/settings/installations/1",
      addedBy: "u-ada",
    },
    {
      id: 2,
      account: "nova",
      accountType: "User",
      repositorySelection: "all",
      repositories: [repo(21, "nova/notes")],
      suspended: false,
      state: "accepted",
      manageUrl: "https://github.com/settings/installations/2",
      addedBy: null,
    },
    {
      id: 3,
      account: "juno",
      accountType: "Organization",
      repositorySelection: "selected",
      repositories: [repo(31, "juno/old")],
      suspended: true,
      state: "suspended",
      manageUrl: "https://github.com/organizations/juno/settings/installations/3",
      addedBy: null,
    },
  ],
} satisfies HqGithubView["apps"][number];
const CONNECTED: HqGithubView = { apps: [ACME] };
const NONE: HqGithubView = { apps: [] };
const decodeGithub = Schema.decodeUnknownSync(HqGithubView);
const decodeSlack = Schema.decodeUnknownSync(HqSlackView);
const decodeDiscord = Schema.decodeUnknownSync(HqDiscordView);
const known = (held: HqGithubView) => ({ state: "known", held, stale: false }) as const;

describe("Settings › Automation's GitHub section", () => {
  it.each([
    {
      case: "an organization with no app",
      setting: known(NONE),
      admin: true,
      says: "No GitHub app yet",
    },
    {
      case: "a member where no app is connected",
      setting: known(NONE),
      admin: false,
      says: "No GitHub app yet · The organization's Owner and Admins add GitHub apps.",
    },
    {
      case: "a connected app",
      setting: known(CONNECTED),
      admin: false,
      says: "1 GitHub app · pushes as acme-mate[bot]",
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
    expect(githubSection(known(NONE), true)).toEqual({ kind: "apps", apps: [], manage: true });
    expect(githubSection(known(NONE), false)).toEqual({ kind: "apps", apps: [], manage: false });
  });

  it("lists where a connected app is installed, each with its page on GitHub", () => {
    const section = githubSection(known(CONNECTED), true);
    expect(section.kind === "apps" ? section.apps[0]?.installations : null).toEqual([
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
    expect(appRepositories(NONE)).toEqual([]);
    expect(appRepositories(null)).toEqual([]);
  });
});

describe("an installation GitHub did not answer about", () => {
  const unread = recorded("GET /api/org/github", "org-github.installation-unknown");

  // witness: apps/web/src/components/settings/automationSettings.logic.ts | if (installation.state === "unknown") return "unknown"; → if (installation.state === "unknown") return "waiting";
  it("GitHub settings list it by its id, with no page to manage it, and no account waiting", () => {
    const section = githubSection(known(unread), true);
    expect(section.kind === "apps" ? section.apps[0]?.installations : null).toEqual([
      { id: 10006, line: expect.any(String), manageUrl: null, suspended: false },
    ]);
    expect(section.kind === "apps" ? section.apps[0]?.waiting : null).toEqual([]);
  });

  // witness: apps/web/src/components/settings/automationSettings.logic.ts | (installation) => installation.state === "unknown" → (installation) => installation.state === "suspended"
  it("the mirror dialog and the origin sheet are told how many installations GitHub did not answer about, and offer none of their repositories", () => {
    expect(unansweredInstallations(unread)).toBe(1);
    expect(appRepositories(unread)).toEqual([]);
    expect(unansweredInstallations(recorded("GET /api/org/github", "org-github.connected"))).toBe(
      0,
    );
  });
});

describe("coming back from GitHub", () => {
  it("confirms a connected app, and says an owner's approval is asked where GitHub asked one", () => {
    expect(githubReturnLine("connected", githubSection(known(CONNECTED), true))).toBe(
      "Acme Mate is set up. Mate acts through it as acme-mate[bot].",
    );
    expect(githubReturnLine("requested", githubSection(known(CONNECTED), true))).toBe(
      "GitHub asked an owner of the GitHub account to approve the app; it's installed once they do.",
    );
    expect(githubReturnLine(null, githubSection(known(CONNECTED), true))).toBeNull();
    expect(githubReturnLine("connected", githubSection(known(NONE), true))).toBeNull();
  });
});

describe("one app on many GitHub accounts", () => {
  const MANY: HqGithubView = {
    apps: [
      {
        ...ACME,
        installations: [
          ...ACME.installations.slice(0, 2),
          {
            id: 4,
            account: "stranger",
            accountType: "User",
            repositorySelection: "selected",
            repositories: [repo(41, "stranger/notes"), repo(42, "stranger/site", false)],
            suspended: false,
            state: "waiting",
            manageUrl: "https://github.com/settings/installations/4",
            addedBy: null,
          },
        ],
      },
    ],
  };
  const first = (view: HqGithubView, admin: boolean) => {
    const section = githubSection(known(view), admin);
    return section.kind === "apps" ? section.apps[0] : undefined;
  };

  it("an app installed on two accounts lists both", () => {
    expect(first(MANY, true)?.installations.map(({ line }) => line)).toEqual([
      "acme · 3 repositories",
      "nova · all repositories",
    ]);
    expect(appRepositories(MANY)).toEqual(["acme/api", "acme/tea-shop", "acme/web", "nova/notes"]);
  });

  it("an installation not started here waits for an admin's OK and its repositories aren't offered", () => {
    expect(first(MANY, false)?.waiting).toEqual([
      {
        id: 4,
        account: "stranger",
        repositories: ["stranger/notes", "stranger/site"],
      },
    ]);
    expect(appRepositories(MANY)).not.toContain("stranger/notes");
  });

  it("a private app says it installs only on its owner, with the page that makes it public", () => {
    const owned = (ownerType?: "User" | "Organization") =>
      first(
        {
          apps: [{ ...ACME, public: false, ...(ownerType === undefined ? {} : { ownerType }) }],
        },
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
    expect(first(MANY, true)).toMatchObject({ privateTo: null });
  });

  it("says GitHub's install waits for an OK only while an installation here waits for one", () => {
    expect(githubReturnLine("waiting", githubSection(known(MANY), true))).toBe(
      "GitHub installed the app. It waits for an Owner's or Admin's OK before Mate uses it.",
    );
    // Accepted or suspended since, another organization's, or one with no app: nothing to say.
    expect(githubReturnLine("waiting", githubSection(known(CONNECTED), true))).toBeNull();
    expect(githubReturnLine("waiting", githubSection(known(NONE), true))).toBeNull();
  });
});

describe("who an organization-wide credential is held as", () => {
  const people = new Map([["u-ada", "Ada Lovelace"]]);
  const nameOf = (userId: string) => people.get(userId);
  const day = (iso: string) => iso.slice(0, 10);
  const github = (seal: { readonly sealedBy: string; readonly sealedAt: string }) => {
    const view = decodeGithub({ apps: [{ ...ACME, installations: [], ...seal }] });
    const section = githubSection(known(view), true);
    const app = section.kind === "apps" ? section.apps[0] : undefined;
    return app === undefined ? null : appSetUpWords(app.seal, nameOf, day);
  };

  // witness: apps/web/src/components/settings/automationSettings.logic.ts | const name = nameOf(seal.by) ?? "an Owner or Admin"; → const name = "an Owner or Admin";
  it("a GitHub app names the Owner or Admin who sealed it, as the member list names them, and when", () => {
    expect(github({ sealedBy: "u-ada", sealedAt: "2026-11-07T14:11:01.000Z" })).toBe(
      "set up by Ada Lovelace, 2026-11-07",
    );
    // Somebody the member list does not hold is said by their role.
    expect(github({ sealedBy: "u-gone", sealedAt: "2026-11-07T14:11:01.000Z" })).toBe(
      "set up by an Owner or Admin, 2026-11-07",
    );
  });

  // witness: apps/web/src/components/settings/automationSettings.logic.ts | const tail = sealedWords(view.connectedBy, view.connectedAt, nameOf, day); → const tail = "";
  it("Slack and Discord name who connected them and when; an older HQ's say neither", () => {
    const slack = decodeSlack({
      connected: true,
      workspace: "Acme",
      eventsUrl: "https://hq.example/api/intake/slack/pub-1",
      eventsRefusedAt: null,
      eventsAcceptedAt: null,
      connectedBy: "u-ada",
      connectedAt: "2026-11-07T14:11:01.000Z",
    });
    const discord = decodeDiscord({
      connected: true,
      interactionsUrl: "https://hq.example/api/intake/discord/pub-2",
      inviteUrl: null,
      allowed: [],
      connectedBy: "u-gone",
      connectedAt: "2026-11-06T09:00:00.000Z",
    });
    const older = decodeDiscord({
      connected: true,
      interactionsUrl: "https://hq.example/api/intake/discord/pub-2",
      inviteUrl: null,
      allowed: [],
    });
    expect(connectedByLine(slack, nameOf, day)).toBe("Connected by Ada Lovelace on 2026-11-07.");
    expect(connectedByLine(discord, nameOf, day)).toBe("Connected on 2026-11-06.");
    expect(connectedByLine(older, nameOf, day)).toBeNull();
  });
});
