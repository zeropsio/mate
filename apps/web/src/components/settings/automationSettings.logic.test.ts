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
  githubSealLine,
  githubReturnTo,
  githubSection,
  githubStatus,
  postManifest,
  unansweredInstallations,
} from "./automationSettings.logic";
import { recorded } from "@t3tools/test-recordings/recorded";

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
const decodeGithub = Schema.decodeUnknownSync(HqGithubView);
const decodeSlack = Schema.decodeUnknownSync(HqSlackView);
const decodeDiscord = Schema.decodeUnknownSync(HqDiscordView);
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

describe("an installation GitHub did not answer about", () => {
  const unread = recorded("GET /api/org/github", "org-github.installation-unknown");

  // witness: apps/web/src/components/settings/automationSettings.logic.ts | if (installation.state === "unknown") return "unknown"; → if (installation.state === "unknown") return "waiting";
  it("GitHub settings list it by its id, with no page to manage it, and no account waiting", () => {
    const section = githubSection(known(unread), true);
    expect(section.kind === "connected" ? section.installations : null).toEqual([
      { id: 10006, line: expect.any(String), manageUrl: null, suspended: false },
    ]);
    expect(section.kind === "connected" ? section.waiting : null).toEqual([]);
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

describe("who an organization-wide credential is held as", () => {
  const people = new Map([["u-ada", "Ada Lovelace"]]);
  const nameOf = (userId: string) => people.get(userId);
  const day = (iso: string) => iso.slice(0, 10);
  // HQ main's GitHub view (mate-hq 01e86bfe81, spec/protocol.md S10a) and v0.4.2's, which keeps no seal.
  const github = (seal: object) => {
    const view = decodeGithub({
      state: "connected",
      slug: "acme-mate",
      appId: 123456,
      botLogin: "acme-mate[bot]",
      owner: "acme",
      appUrl: "https://github.com/apps/acme-mate",
      installUrl: "https://github.com/apps/acme-mate/installations/new",
      public: true,
      installations: [],
      ...seal,
    });
    const section = githubSection(known(view), true);
    return section.kind === "connected" ? githubSealLine(section.seal, nameOf, day) : section.kind;
  };

  // witness: apps/web/src/components/settings/automationSettings.logic.ts | if (view.sealedBy === null) return { kind: "needed" }; → if (view.sealedBy === null) return { kind: "unrecorded" };
  it("a GitHub app nobody is recorded to have sealed says Mate uses it for nothing until an Owner or Admin makes it again", () => {
    expect(github({ sealedBy: null, sealedAt: null })).toBe(
      "Nobody is recorded to have set this app up, so Mate uses it for nothing until an Owner or Admin makes it again.",
    );
  });

  // witness: apps/web/src/components/settings/automationSettings.logic.ts | const name = by === null || by === undefined ? undefined : nameOf(by); → const name = undefined;
  it("a GitHub app names the Owner or Admin who sealed it, as the member list names them, and when", () => {
    expect(github({ sealedBy: "u-ada", sealedAt: "2026-11-07T14:11:01.000Z" })).toBe(
      "Set up by Ada Lovelace on 2026-11-07.",
    );
    // Somebody the member list does not hold goes unnamed.
    expect(github({ sealedBy: "u-gone", sealedAt: "2026-11-07T14:11:01.000Z" })).toBe(
      "Set up on 2026-11-07.",
    );
  });

  // witness: apps/web/src/components/settings/automationSettings.logic.ts | if (view.sealedBy === undefined) return { kind: "unrecorded" }; → if (view.sealedBy === undefined) return { kind: "needed" };
  it("an older HQ's GitHub app, which keeps no seal record, says nothing of who set it up and is not asked to be made again", () => {
    expect(github({})).toBeNull();
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
