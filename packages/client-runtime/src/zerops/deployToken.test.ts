import { describe, expect, it } from "vite-plus/test";

import { deployTokenMint, deployTokenName, environmentKeyed } from "./deployToken.ts";

describe("deployTokenName", () => {
  // Main's own keys, `deploy-<project name>`, stay in the account's token list beside HQ's: never
  // one name for both, nor two names alike but for case and spaces.
  it("names the token HQ's, after the environment and its project, as the token list shows it", () => {
    expect(deployTokenName(" heron-production ", "q3EjSXjUQjAQ1uilTtGxVg")).toBe(
      "mate-hq-deploy:heron-production:q3EjSXjUQjAQ1uilTtGxVg",
    );
  });
});

describe("deployTokenMint", () => {
  // One key per environment, reaching its own project and nothing else (main E03).
  it("asks for no org role and Basic user on the environment's project alone", () => {
    expect(deployTokenMint({ projectId: "p-stage", environmentName: "stage" })).toEqual({
      name: "mate-hq-deploy:stage:p-stage",
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "p-stage", roleCode: "BASIC_USER" }],
    });
  });
});

describe("environmentKeyed — whether HQ deploys an environment with a key that works", () => {
  it.each([
    ["a key held that works", { keyHeld: true, keyInvalid: false }, true],
    ["no key", { keyHeld: false, keyInvalid: false }, false],
    // HQ's check before a deploy found it gone, or reaching more than its project.
    ["a key HQ found broken", { keyHeld: true, keyInvalid: true }, false],
  ])("%s", (_case, environment, keyed) => {
    expect(environmentKeyed(environment)).toBe(keyed);
  });
});
