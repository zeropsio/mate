import * as Environment from "./hqEnvironment.ts";
import { expect, expectTypeOf, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import type { EnvironmentId, HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import { HqEnvironmentIdentity } from "./hqEnvironment.ts";
import { CanonicalHqNavigationEnvironment, CanonicalHqNavigationEnvironments } from "./hqStream.ts";

const read = Schema.decodeUnknownSync(CanonicalHqNavigationEnvironment);
const readList = Schema.decodeUnknownSync(CanonicalHqNavigationEnvironments);
const payload = {
  tier: "stage",
  name: "Stage",
  sources: ["merge"],
  order: 2,
  keyHeld: true,
  keyInvalid: false,
  can: {},
  jobs: [],
  release: null,
  birth: null,
};

it("An older HQ's environment decodes with a Zerops target and its existing identity.", () => {
  expectTypeOf<HqEnvironmentId>().not.toExtend<ProjectId>();
  expectTypeOf<HqEnvironmentId>().not.toExtend<EnvironmentId>();
  expectTypeOf<CanonicalHqNavigationEnvironment["projectId"]>().toEqualTypeOf<
    ProjectId | undefined
  >();
  expectTypeOf<CanonicalHqNavigationEnvironment["id"]>().toEqualTypeOf<HqEnvironmentId>();
  expectTypeOf<
    Extract<CanonicalHqNavigationEnvironment["target"], { kind: "zerops" }>["projectId"]
  >().toEqualTypeOf<ProjectId>();
  expect(Schema.decodeUnknownSync(HqEnvironmentIdentity)({ projectId: "project" })).toEqual({
    projectId: "project",
    id: "project",
    target: { kind: "zerops", projectId: "project" },
  });
  expect(read({ ...payload, projectId: "project" })).toEqual({
    ...payload,
    projectId: "project",
    id: "project",
    target: { kind: "zerops", projectId: "project" },
  });
});

it.each([
  { kind: "zerops", projectId: "destination" },
  { kind: "git", branch: "production", delivery: "direct" },
  { kind: "git", branch: "staging", delivery: "pr" },
])("An environment with a target decodes without a legacy projectId.", (target) => {
  const value = { ...payload, id: "environment", target };
  expect(read(value)).toEqual(value);
});

it("A modern environment's target is never inferred from its identity or legacy projectId.", () => {
  for (const target of [
    { kind: "zerops", projectId: "destination" },
    { kind: "git", branch: "production", delivery: "direct" },
  ]) {
    const value = { ...payload, id: "identity", projectId: "contradiction", target };
    expect(read(value)).toEqual(value);
  }
  for (const identity of [
    { id: "identity" },
    { target: { kind: "zerops", projectId: "destination" } },
    { id: undefined },
    { target: undefined },
    { id: null, target: { kind: "zerops", projectId: "destination" } },
    { id: "", target: { kind: "zerops", projectId: "destination" } },
    { id: "identity", target: null },
    { id: "identity", target: {} },
    { id: "identity", target: { kind: "zerops" } },
    { id: "identity", target: { kind: "zerops", projectId: " " } },
    { id: "identity", target: { kind: "git", branch: "main" } },
    { id: "identity", target: { kind: "git", branch: " ", delivery: "direct" } },
    { id: "identity", target: { kind: "git", branch: "main", delivery: "unknown" } },
    { id: "identity", target: { kind: "unknown" } },
  ]) {
    expect(() => read({ ...payload, projectId: "legacy", ...identity })).toThrow();
    expect(() =>
      readList([
        { ...payload, projectId: "valid" },
        { ...payload, projectId: "legacy", ...identity },
      ]),
    ).toThrow();
  }
});

it("A git environment beside a Zerops environment does not make the environment list undecodable.", () => {
  const git = {
    ...payload,
    id: "git-id",
    target: { kind: "git", branch: "main", delivery: "direct" },
  };
  const zerops = {
    ...payload,
    id: "zerops-id",
    target: { kind: "zerops", projectId: "destination" },
  };
  expect(readList([git, zerops])).toEqual([git, zerops]);
  expect(readList({ refused: "forbidden" })).toEqual({ refused: "forbidden" });
});

it.each(["feature/release-1", "main", "release_2026"])(
  "A Git target accepts the branch %s without changing its identity.",
  (branch) => {
    const value = {
      ...payload,
      id: "git-id",
      projectId: "unrelated-project",
      target: { kind: "git", branch, delivery: "direct" },
    };
    expect(read(value)).toEqual(value);
  },
);

it.each([
  "a..b",
  "a.lock",
  "/main",
  "main/",
  "a//b",
  "a@{b",
  "a b",
  "a~b",
  "a^b",
  "a:b",
  "a?b",
  "a*b",
  "a[b",
  "a\\b",
  "@",
  ".hidden",
  "main.",
  "refs/heads/main",
  "mate/main",
])("New Git attachment refuses unsafe or reserved branch %s.", (branch) => {
  expect(
    Schema.decodeUnknownExit(CanonicalHqNavigationEnvironment)({
      ...payload,
      id: "git-id",
      target: { kind: "git", branch, delivery: "direct" },
    })._tag,
  ).toBe("Failure");
});

it("Accepted attachment provenance requires both the attachment timestamp and its destination.", () => {
  expect(Environment).toHaveProperty("HqEnvironmentAttachment");
  const value = {
    environmentId: "git-id",
    createdAt: "2026-10-13T10:00:00.000Z",
    target: { kind: "git", branch: "main", delivery: "direct" },
  };
  expect(Schema.decodeUnknownSync(Environment.HqEnvironmentAttachment)(value)).toEqual(value);
  for (const patch of [
    { environmentId: undefined },
    { createdAt: undefined },
    { createdAt: "bad" },
    { target: undefined },
  ]) {
    expect(
      Schema.decodeUnknownExit(Environment.HqEnvironmentAttachment)({ ...value, ...patch })._tag,
    ).toBe("Failure");
  }
});

it("Removing a Git environment names its own environment identity without a project alias.", () => {
  const value = { environmentId: "git-id" };
  expect(Schema.decodeUnknownSync(Environment.RemoveGitEnvironmentRequest)(value)).toEqual(value);
  expect(
    Schema.decodeUnknownExit(Environment.RemoveGitEnvironmentRequest)({
      projectId: "different-project",
    })._tag,
  ).toBe("Failure");
});
