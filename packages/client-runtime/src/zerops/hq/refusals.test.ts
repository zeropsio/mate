import { describe, expect, it } from "@effect/vitest";
import { MERGE_REFUSALS } from "@t3tools/shared/hqChanges";
import { RELEASE_REFUSALS } from "@t3tools/shared/hqRelease";
import type { HqOfferState } from "@t3tools/shared/hqOffers";
import { REASONS } from "@t3tools/shared/zeropsPermissions";

import {
  AUTOMATION_REFUSALS,
  enrollmentRefusalWords,
  hqMergeOfferWords,
  hqOfferWords,
  hqRefusalWords,
  mergeLimitWords,
  mergersRefusalWords,
} from "./refusals.ts";

describe("hqRefusalWords — HQ's refusal, in the person's words", () => {
  it.each([
    [
      "production_taken",
      "That project has its production already. Close this form and open the existing production.",
    ],
    ["branch_taken", "An environment already uses this branch. Choose another branch."],
  ])("A Git environment conflict says how to continue: %s", (reason, expected) => {
    expect(hqRefusalWords({ code: "conflict", reason })).toBe(expected);
  });

  it.each([...REASONS])("says %s in words of its own, never the code", (reason) => {
    const words = hqRefusalWords({ code: "forbidden", reason });
    expect(words).not.toContain(reason);
    expect(words).toMatch(/^[A-Z].*\.$/u);
  });

  // Automated Mates' sources (`mate-hq apps/hq/src/{intake,slack,discord,webhooks,schedules,taskLimits}.ts`).
  it.each([...AUTOMATION_REFUSALS])(
    "says why HQ refused a task source's setting (%s) in words of its own, never the code",
    (reason) => {
      const words = hqRefusalWords({ code: "invalid", reason });
      expect(words).not.toContain(`(${reason})`);
      expect(words).not.toContain("_");
      expect(words).toMatch(/^[A-Z@].*\.$/u);
    },
  );

  // witness: packages/client-runtime/src/zerops/hq/refusals.ts | needs_owner_seal: → needs_owner_seal_unknown:
  it.each([
    ["github_unavailable", "HQ could not set the GitHub app up just now. Try again."],
    [
      "needs_owner_seal",
      "Nobody is recorded to have set this GitHub app up, so Mate uses it for nothing. An Owner or Admin makes it again.",
    ],
    [
      "repository_changed",
      "The repository on GitHub is no longer the one connected. Connect it again under Repositories.",
    ],
  ])("says why HQ refused the GitHub app's setting, %s, and what to do", (reason, expected) => {
    expect(hqRefusalWords({ code: "conflict", reason })).toBe(expected);
  });

  it("tells a person to invite Mate to a Slack channel it is not in", () => {
    expect(hqRefusalWords({ code: "conflict", reason: "not_in_channel" })).toBe(
      "Invite @Mate to the channel first, then try again.",
    );
  });

  it("offers no remedy for a kind it does not know that reloading cannot give: the kind is HQ's", () => {
    expect(hqRefusalWords({ code: "forbidden", reason: "unknown_kind" })).toBe(
      "HQ and this version of Mate do not know the same kinds of project, so this one is left as it is.",
    );
  });

  it.each([
    ["app_name_taken", "conflict", "Another project already has this name."],
    [
      "app_not_empty",
      "conflict",
      "This project is no longer empty: a Mate, an environment or a change is in it now.",
    ],
    [
      "app_has_mate",
      "conflict",
      "A Mate still works on this project. Delete it first, or try again in a minute if it was just deleted.",
    ],
    ["held_changed", "conflict", "Somebody changed this project in HQ meanwhile. Try again."],
    ["name_length", "invalid", "A name has 1 to 100 characters."],
    // D3: a Mate's face is all HQ records of it.
    ["face_length", "invalid", "A face has at most 64 characters."],
    ["mate_record_with_kind", "invalid", "Only a Mate has a face."],
    ["change_not_found", "change_not_found", "HQ has no such change."],
    ["change_not_open", "conflict", "This change is merged or closed already."],
    // A change handed to another Mate once its own is gone.
    [
      "change_has_mate",
      "conflict",
      "This change's Mate is in the project, so it stays that Mate's.",
    ],
    ["not_app_mate", "conflict", "That Mate is no longer in this project."],
    ["mate_has_change", "conflict", "That Mate has an open change of its own in this repository."],
    ["recipe_too_large", "too_large", "This project's recipe is too large to read here."],
    // An application's environments and their deploy keys (SPEC §3.2b).
    ["environment_with_kind", "invalid", "Only a stage or a production is an environment."],
    ["environment_name_missing", "invalid", "An environment needs a name."],
    [
      "environment_name_invalid",
      "invalid",
      "An environment's name starts with a letter and has only small letters, digits and dashes.",
    ],
    ["environment_name_long", "invalid", "An environment's name has at most 63 characters."],
    [
      "environment_name_taken",
      "conflict",
      "This project has an environment of that name already. Close this form and open Add again to get a new name.",
    ],
    ["environment_not_found", "environment_not_found", "HQ has no such environment."],
    ["deploy_token_refused", "invalid", "Zerops did not accept this deploy key."],
    ["deploy_token_scope", "invalid", "This deploy key reaches more than its own project."],
    [
      "no_key_secret",
      "conflict",
      "HQ has no key to keep deploy keys with yet. Whoever runs this HQ sets its HQ_KEY_SECRET.",
    ],
    // A deploy asked again ("Run again").
    ["deploy_not_found", "deploy_not_found", "HQ has no such deploy."],
    ["deploy_superseded", "conflict", "A newer deploy took this one's place."],
    ["deploy_running", "conflict", "HQ is deploying it now."],
    // A service added ("Add <service>").
    ["service_not_declared", "conflict", "The recipe declares no such service here."],
  ])("says the structure's own %s in words", (reason, code, words) => {
    expect(hqRefusalWords({ code, reason })).toBe(words);
  });

  // Zerops refusing HQ itself (`403 zerops_refused`): what Zerops said no to, and who can fix it.
  it.each([
    [
      "unauthorized",
      "Zerops no longer accepts HQ's access. An owner or admin of the organization sets HQ up again.",
    ],
    [
      "forbidden",
      "Zerops does not let HQ read this. An owner or admin of the organization checks HQ's access in Zerops.",
    ],
    ["not_found", "Zerops has no such project or service any more."],
    ["invalid", "Zerops did not accept HQ's request. Tell an owner or admin of the organization."],
  ])("says Zerops' own refusal of HQ, %s, in words of its own", (reason, words) => {
    expect(hqRefusalWords({ code: "zerops_refused", reason })).toBe(words);
  });

  it.each([...MERGE_REFUSALS])("says why HQ did not merge, %s, in words of its own", (reason) => {
    const words = hqRefusalWords({ code: "conflict", reason });
    expect(words).not.toContain(reason);
    expect(words).toMatch(/^[A-Z].*\.$/u);
  });

  // A merge refused (`MERGE_REFUSALS`): what stopped it, so the person knows whether pressing again
  // can help — only where main moved meanwhile.
  it.each([
    ["head_moved", "Its Mate pushed to it since you opened it. Review it again."],
    ["conflict", "It no longer merges cleanly into main."],
    ["empty", "There is nothing in it that main does not have."],
    ["already_merged", "It is on main already."],
    ["unrelated", "It shares no history with main."],
    ["no_change", "Nothing was pushed to it yet."],
    ["main_moved", "Other changes kept landing on main meanwhile. Try again."],
    [
      "github_blocked",
      "GitHub won't merge its PR yet: the repository's rules or required checks hold it back. See its PR on GitHub.",
    ],
    ["github_refused", "GitHub refused to merge its PR. See its PR on GitHub."],
  ])("says %s as it stands", (reason, words) => {
    expect(hqRefusalWords({ code: "conflict", reason })).toBe(words);
  });

  it.each([...RELEASE_REFUSALS])(
    "says why HQ made no release, %s, in words of its own",
    (reason) => {
      const words = hqRefusalWords({ code: "conflict", reason });
      expect(words).not.toContain(reason);
      expect(words).toMatch(/^[A-Z].*\.$/u);
    },
  );

  // A release or a rollback HQ did not make (`RELEASE_REFUSALS`): only a main that moved, or a
  // newer release, is helped by reviewing it again.
  it.each([
    ["group_moved", "conflict", "Main moved since you opened this. Review it again."],
    ["no_group_main", "conflict", "The project's recipe has nothing on main to tag yet."],
    ["tag_taken", "conflict", "A release of this name was made meanwhile. Review it again."],
    ["tag_not_newer", "conflict", "A newer release was made meanwhile. Review it again."],
    ["unknown_service", "conflict", "It lists a service the project's production does not have."],
    ["entry_not_on_main", "conflict", "It lists a commit that is not on main."],
    [
      "release_not_approved",
      "conflict",
      "That release was refused, so production cannot go back to it.",
    ],
    [
      "git_release_blocked",
      "conflict",
      "Mate couldn't confirm the production branch is ready for this release, so nothing was pushed. Review it again.",
    ],
    [
      "release_running",
      "conflict",
      "The previous release is still being pushed. Release again once it is pushed.",
    ],
    ["release_not_found", "release_not_found", "HQ has no such release."],
  ])("says %s as it stands", (reason, code, words) => {
    expect(hqRefusalWords({ code, reason })).toBe(words);
  });

  // A comparison of two commits (`CompareResponse`), one of which its repository does not have.
  it("says a commit the repository does not have as it stands", () => {
    expect(hqRefusalWords({ code: "commit_not_found", reason: "commit_not_found" })).toBe(
      "HQ has no such commit.",
    );
  });

  it("names a refusal this build has no words for by its code", () => {
    expect(hqRefusalWords({ code: "conflict", reason: "newer_rule" })).toBe(
      "HQ refused this (newer_rule).",
    );
    expect(hqRefusalWords({ code: "too_large", reason: undefined })).toBe(
      "HQ refused this (too_large).",
    );
  });
});

// zcp's enrollment, refused (`MateRefused` in `mate-hq apps/hq/src/mateCredentials.ts`): what stands, and
// what the person can do — or that it tries again on its own.
describe("enrollmentRefusalWords — HQ's refusal of a Mate's enrollment", () => {
  it.each([
    ["not_a_mate", "HQ has no record of this Mate yet."],
    ["project_not_in_org", "Its Zerops project is not in this HQ's organization."],
    ["project_gone", "Its Zerops project is gone."],
    ["env_mismatch", "HQ could not check its Zerops project yet. It tries again on its own."],
    ["expired", "HQ could not check its Zerops project yet. It tries again on its own."],
    ["unknown_nonce", "HQ could not check its Zerops project yet. It tries again on its own."],
    [
      "not_this_projects_mate",
      "Another Zerops Control Plane in its project is the project's Mate, and a project holds one. Delete this one in Zerops, or delete the other and restart this one.",
    ],
    ["later_code", "HQ refused it (later_code). It tries again on its own."],
    [undefined, "HQ refused it. It tries again on its own."],
  ] as const)("%s", (code, words) => {
    expect(enrollmentRefusalWords(code)).toBe(words);
  });
});

describe("hqOfferWords — what a control says beside a verb HQ does not offer", () => {
  it.each<[string, HqOfferState, string | undefined]>([
    ["nothing for an offered verb", { kind: "allowed" }, undefined],
    [
      "HQ's refusal alone where it named no time",
      { kind: "refused", reason: "not_structure_writer" },
      "Only an owner or admin of the organization can do this.",
    ],
    ["that HQ has not said yet", { kind: "unknown" }, "HQ has not said yet."],
  ])("%s", (_, state, words) => {
    expect(hqOfferWords(state)).toBe(words);
  });
});

describe("hqRefusalWords — a repository HQ will not delete", () => {
  it.each([
    ["group_repository", "main repository"],
    ["in_use:git_environment", "environment"],
    ["in_use:remote", "mirror"],
    ["in_use:open_change", "open change"],
    ["in_use:deploy", "deploy"],
  ])("says %s in plain words that name what holds it", (reason, holder) => {
    const words = hqRefusalWords({ code: "conflict", reason });
    expect(words).toContain(holder);
    expect(words).not.toContain(reason);
    expect(words).toMatch(/^[A-Z].*\.$/u);
  });
});

describe("who merges where a project limits it", () => {
  const NAMES: Readonly<Record<string, string>> = {
    "u-ada": "Ada K.",
    "u-sam": "Sam R.",
    "u-lee": "Lee P.",
    "u-noor": "Noor T.",
  };
  const nameOf = (userId: string) => NAMES[userId];

  // witness: packages/client-runtime/src/zerops/hq/refusals.ts | `Only ${named.join(", ")}${rest} and → `Only ${named.join(" and ")}${rest} and
  it("The held press names the people who merge, then the organization's Owner and Admins", () => {
    expect(mergeLimitWords(["u-ada", "u-sam"], nameOf)).toBe(
      "Only Ada K., Sam R. and the organization's Owner and Admins merge here.",
    );
  });

  // witness: packages/client-runtime/src/zerops/hq/refusals.ts | if (people.length === 0) return `Only ${OWNER_AND_ADMINS} merge here.`; →
  it("With nobody named, only the organization's Owner and Admins merge", () => {
    expect(mergeLimitWords([], nameOf)).toBe(
      "Only the organization's Owner and Admins merge here.",
    );
  });

  // witness: packages/client-runtime/src/zerops/hq/refusals.ts | const MERGERS_NAMED = 3; → const MERGERS_NAMED = 4;
  it("More than three people are the first three by name and how many more", () => {
    expect(mergeLimitWords(["u-ada", "u-sam", "u-lee", "u-noor", "u-gone"], nameOf)).toBe(
      "Only Ada K., Sam R., Lee P. and 2 more, and the organization's Owner and Admins merge here.",
    );
  });

  // witness: packages/client-runtime/src/zerops/hq/refusals.ts | nameOf(userId) ?? [] → nameOf(userId) ?? userId
  it("People the member list does not name are counted, never shown as ids", () => {
    expect(mergeLimitWords(["u-gone", "u-left"], nameOf)).toBe(
      "Only 2 people and the organization's Owner and Admins merge here.",
    );
  });

  // witness: packages/client-runtime/src/zerops/hq/refusals.ts | state.kind === "refused" && state.reason === "not_app_merger" → false
  it("A press the merge limit holds says who merges; any other refusal keeps its own words", () => {
    const mergers = { people: ["u-ada"] };
    expect(hqMergeOfferWords({ kind: "refused", reason: "not_app_merger" }, mergers, nameOf)).toBe(
      "Only Ada K. and the organization's Owner and Admins merge here.",
    );
    expect(
      hqMergeOfferWords({ kind: "refused", reason: "not_app_developer" }, mergers, nameOf),
    ).toBe("You need more than Read access to one of this project's Zerops projects to do this.");
  });
});

describe("HQ's refusal of who merges", () => {
  // witness: packages/client-runtime/src/zerops/hq/refusals.ts | if (code === "conflict" && reason === "not_active_member") → if (code === "forbidden" && reason === "not_active_member")
  it("A named person Zerops no longer lists is theirs to uncheck, never the asker's own membership", () => {
    expect(mergersRefusalWords({ code: "conflict", reason: "not_active_member" })).toBe(
      "Someone you picked is no longer an active member of this organization. Uncheck them and save again.",
    );
    expect(mergersRefusalWords({ code: "forbidden", reason: "not_active_member" })).toBeUndefined();
  });

  // witness: packages/client-runtime/src/zerops/hq/refusals.ts | if (reason === "not_structure_writer") return MERGERS_WRITERS; →
  it("Someone who is no Owner or Admin is told who changes it", () => {
    expect(mergersRefusalWords({ code: "forbidden", reason: "not_structure_writer" })).toBe(
      "Owners and Admins change this.",
    );
  });

  // witness: packages/client-runtime/src/zerops/hq/refusals.ts | return `HQ didn't take this list. Pick at most ${String(HQ_MERGERS_MAX)} people.`; → return undefined;
  it("A list HQ does not take says how many people it holds", () => {
    expect(mergersRefusalWords({ code: "invalid", reason: "people" })).toBe(
      "HQ didn't take this list. Pick at most 50 people.",
    );
  });

  // witness: packages/client-runtime/src/zerops/hq/refusals.ts | if (code === "app_not_found" || reason === "app_not_found") → if (reason === "app_not_found")
  it("A project gone from HQ is said so, by HQ's code alone", () => {
    expect(mergersRefusalWords({ code: "app_not_found", reason: undefined })).toBe(
      "This project is gone from HQ.",
    );
  });
});
