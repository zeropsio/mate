import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import {
  CreateProjectRepo,
  ProjectIdentity,
  ProjectRefusal,
  ProjectRepository,
} from "./project.ts";

it("reads a plain project's HQ identity and repository without a Mate", () => {
  expect(
    Schema.decodeUnknownSync(ProjectIdentity)({ orgId: "org", projectId: "project", appId: "app" }),
  ).toEqual({ orgId: "org", projectId: "project", appId: "app" });
  expect(Schema.decodeUnknownSync(ProjectRepository)({ appId: "app", name: "web-dev" })).toEqual({
    appId: "app",
    name: "web-dev",
  });
});

it("accepts an optional project assertion and rejects names outside HQ's repository wire", () => {
  const decode = Schema.decodeUnknownSync(CreateProjectRepo);
  expect(decode({ name: "web-dev" })).toEqual({ name: "web-dev" });
  expect(decode({ name: "web-dev", projectId: "project" })).toEqual({
    name: "web-dev",
    projectId: "project",
  });
  expect(() => decode({ name: "../web" })).toThrow();
});

it.each([
  "project_key_required",
  "key_refused",
  "key_too_wide",
  "key_not_sensitive",
  "not_plain",
  "project_gone",
  "project_not_found",
  "zerops_refused",
  "zerops_unanswered",
])("reads HQ's plain-project refusal %s with its reason", (code) => {
  expect(Schema.decodeUnknownSync(ProjectRefusal)({ code, reason: "HQ's reason" })).toEqual({
    code,
    reason: "HQ's reason",
  });
});
