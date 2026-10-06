import { describe, expect, it } from "@effect/vitest";
import { MERGE_REFUSALS } from "@t3tools/shared/hqChanges";
import { RELEASE_REFUSALS } from "@t3tools/shared/hqRelease";
import type { HqOfferState } from "@t3tools/shared/hqOffers";
import { REASONS } from "@t3tools/shared/zeropsPermissions";

import { enrollmentRefusalWords, hqOfferWords, hqRefusalWords } from "./refusals.ts";

describe("hqRefusalWords — HQ's refusal, in the person's words", () => {
  it.each([...REASONS])("says %s in words of its own, never the code", (reason) => {
    const words = hqRefusalWords({ code: "forbidden", reason });
    expect(words).not.toContain(reason);
    expect(words).toMatch(/^[A-Z].*\.$/u);
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
    ["held_changed", "conflict", "Somebody changed this project in HQ meanwhile. Try again."],
    ["name_length", "invalid", "A name has 1 to 100 characters."],
    // D3: a Mate's face is all HQ records of it.
    ["face_length", "invalid", "A face has at most 64 characters."],
    ["mate_record_with_kind", "invalid", "Only a Mate has a face."],
    ["change_not_found", "change_not_found", "HQ has no such change."],
    ["change_not_open", "conflict", "This change is merged or closed already."],
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
    ["environment_name_taken", "conflict", "This project has an environment of that name already."],
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
    ["change_not_open", "This change is merged or closed already."],
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

// zcp's enrollment, refused (`MateRefused` in `apps/hq/src/mateCredentials.ts`): what stands, and
// what the person can do — or that it tries again on its own.
describe("enrollmentRefusalWords — HQ's refusal of a Mate's enrollment", () => {
  it.each([
    ["not_a_mate", "HQ has no record of this Mate yet. Finish its setup from its menu."],
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
  const at = (ms: number) => `@${String(ms)}`;
  it.each<[string, HqOfferState, string | null, string | undefined]>([
    ["nothing for an offered verb", { kind: "allowed" }, null, undefined],
    [
      "HQ's refusal, as of the roles it was decided over",
      { kind: "refused", reason: "not_releaser" },
      "1970-01-01T00:00:01.000Z",
      "You need at least Basic user access to this project's production to release it. Zerops roles as of @1000.",
    ],
    [
      "HQ's refusal alone where it named no time",
      { kind: "refused", reason: "not_structure_writer" },
      null,
      "Only an owner or admin of the organization can do this.",
    ],
    ["that HQ has not said yet", { kind: "unknown" }, null, "HQ has not said yet."],
    [
      "since when HQ does not answer",
      { kind: "unavailable", since: 2_000 },
      null,
      "HQ unavailable since @2000.",
    ],
  ])("%s", (_, state, rolesAnsweredAt, words) => {
    expect(hqOfferWords(state, { at, rolesAnsweredAt })).toBe(words);
  });
});
