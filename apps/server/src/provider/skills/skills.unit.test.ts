import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { planClaudeSkillDispatch } from "../Drivers/ClaudeSkillDispatch.ts";
import { discoverClaudeSkills, skillOverrideSettingsPaths } from "../Drivers/ClaudeSkills.ts";

function skillMap(names: ReadonlyArray<string>) {
  return new Map(names.map((name) => [name, { path: `/skills/${name}/SKILL.md` }]));
}

const SKILLS = skillMap(["2spec", "implement", "review", "re-release-version"]);

function writeSkill(skillsDir: string, directoryName: string, contents: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillDir = path.join(skillsDir, directoryName);
    yield* fs.makeDirectory(skillDir, { recursive: true });
    yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), contents);
  });
}

// witness: apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts | /(^|\s)\p{Sc}(?! → /(^|)\p{Sc}(?!
it("SK1: A `$name` mention that names no discovered skill, or is glued to the text before it, stays prose and dispatches nothing", () => {
  expect(planClaudeSkillDispatch("fix the build", SKILLS)).toBeUndefined();
  expect(planClaudeSkillDispatch("echo $HOME then $unknown", SKILLS)).toBeUndefined();
  expect(planClaudeSkillDispatch("cost is 5$implement", SKILLS)).toBeUndefined();
});

// witness: apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts | const last = mentions.at(-1); → const last = mentions.at(0);
it("SK2: The last mention of a known skill becomes the trailing slash command with the rest of the prompt as its arguments, earlier mentions become `/name` inline in the whole prompt that leads it, and a mention that opens the prompt sends one command block alone", () => {
  expect(planClaudeSkillDispatch("ok, now $implement all the tickets", SKILLS)).toEqual({
    leadingText: "ok, now /implement all the tickets",
    commandText: "/implement all the tickets",
    skillName: "implement",
  });
  expect(planClaudeSkillDispatch("$review\nfocus on auth", SKILLS)).toEqual({
    leadingText: undefined,
    commandText: "/review\nfocus on auth",
    skillName: "review",
  });
  expect(planClaudeSkillDispatch("$review the diff, then $implement the fixes", SKILLS)).toEqual({
    leadingText: "/review the diff, then /implement the fixes",
    commandText: "/implement the fixes",
    skillName: "implement",
  });
});

// witness: apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts | (?:[kKmMbBtT]|[eE][0-9]+)? → (?:[eE][0-9]+)?
it("SK3: Any currency sign opens a mention as `$` does and a skill name may begin with a digit, while an amount after any currency sign (20, 20k, 100M, 1e6) is never a mention, even where a skill bears that name", () => {
  expect(planClaudeSkillDispatch("use $2spec for this", SKILLS)).toEqual({
    leadingText: "use /2spec for this",
    commandText: "/2spec for this",
    skillName: "2spec",
  });
  for (const symbol of ["€", "£", "¥", "₹", "₩", "₿", "𑿝"]) {
    expect(
      planClaudeSkillDispatch(
        `${symbol}review the diff, then ${symbol}implement the fixes`,
        SKILLS,
      ),
    ).toEqual({
      leadingText: "/review the diff, then /implement the fixes",
      commandText: "/implement the fixes",
      skillName: "implement",
    });
    expect(planClaudeSkillDispatch(`${symbol}2spec for this`, SKILLS)).toEqual({
      leadingText: undefined,
      commandText: "/2spec for this",
      skillName: "2spec",
    });
    expect(planClaudeSkillDispatch(`5${symbol}review ${symbol}unknown`, SKILLS)).toBeUndefined();
  }
  const skillsWithCurrency = skillMap([...SKILLS.keys(), "20", "20k", "100M", "1e6"]);
  for (const symbol of ["$", "€", "£", "¥", "₹", "₩", "₿", "𑿝"]) {
    expect(
      planClaudeSkillDispatch(
        `pay ${symbol}20 ${symbol}20k ${symbol}100M ${symbol}1e6 tomorrow`,
        skillsWithCurrency,
      ),
    ).toBeUndefined();
  }
});

// witness: apps/server/src/provider/Drivers/ClaudeSkills.ts | if (skillsByName.has(name)) { → if (skillsByName.has(name) && root.prefix !== undefined) {
it.effect(
  "SK4: The skills offered for Claude are the user's `<config dir>/skills` and the project's `.claude/skills`, never `.agents/skills`, and on a name collision the user's skill is the one offered",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const configDir = path.join(tempDir, "claude-home");
      const workspace = path.join(tempDir, "workspace");
      yield* writeSkill(
        path.join(configDir, "skills"),
        "codex-review",
        [
          "---",
          "name: codex-review",
          "description: Ask Codex for a review.",
          "---",
          "",
          "# Body",
        ].join("\n"),
      );
      yield* writeSkill(
        path.join(workspace, ".claude", "skills"),
        "deploy",
        ["---", "name: deploy", "description: Deploy the app.", "---", "", "# Deploy"].join("\n"),
      );
      assert.deepEqual(yield* discoverClaudeSkills({ homePath: configDir }, workspace), [
        {
          name: "codex-review",
          path: path.join(configDir, "skills", "codex-review", "SKILL.md"),
          enabled: true,
          scope: "user",
          description: "Ask Codex for a review.",
        },
        {
          name: "deploy",
          path: path.join(workspace, ".claude", "skills", "deploy", "SKILL.md"),
          enabled: true,
          scope: "project",
          description: "Deploy the app.",
        },
      ]);

      const agentsDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      yield* writeSkill(
        path.join(agentsDir, "workspace", ".agents", "skills"),
        "review",
        ["---", "name: review", "description: Review the changes.", "---"].join("\n"),
      );
      assert.deepEqual(
        yield* discoverClaudeSkills(
          { homePath: path.join(agentsDir, "claude-home") },
          path.join(agentsDir, "workspace"),
        ),
        [],
      );

      const strayDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const strayHome = path.join(strayDir, "claude-home");
      const strayWorkspace = path.join(strayDir, "workspace");
      yield* writeSkill(
        path.join(strayHome, "skills"),
        "deploy",
        ["---", "name: deploy", "description: User deploy.", "---"].join("\n"),
      );
      yield* writeSkill(
        path.join(strayWorkspace, ".agents", "skills"),
        "deploy",
        ["---", "name: deploy", "description: Agents deploy.", "---"].join("\n"),
      );
      yield* writeSkill(
        path.join(strayWorkspace, ".claude", "skills"),
        "deploy",
        ["---", "name: deploy", "description: Claude deploy.", "---"].join("\n"),
      );
      assert.deepEqual(yield* discoverClaudeSkills({ homePath: strayHome }, strayWorkspace), [
        {
          name: "deploy",
          path: path.join(strayHome, "skills", "deploy", "SKILL.md"),
          enabled: true,
          scope: "user",
          description: "User deploy.",
        },
      ]);

      const collisionDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const collisionHome = path.join(collisionDir, "claude-home");
      const collisionWorkspace = path.join(collisionDir, "workspace");
      yield* writeSkill(
        path.join(collisionHome, "skills"),
        "deploy",
        ["---", "name: deploy", "description: User deploy.", "---"].join("\n"),
      );
      yield* writeSkill(
        path.join(collisionWorkspace, ".claude", "skills"),
        "deploy",
        ["---", "name: deploy", "description: Project deploy.", "---"].join("\n"),
      );
      const collision = yield* discoverClaudeSkills(
        { homePath: collisionHome },
        collisionWorkspace,
      );
      assert.equal(collision.length, 1);
      assert.equal(collision[0]?.scope, "user");
      assert.equal(collision[0]?.description, "User deploy.");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Drivers/ClaudeSkills.ts | let name = directoryName; → let name = (frontmatter.kind === "parsed" && frontmatter.name) || directoryName;
it.effect(
  "SK5: A skill is named and switched off by its directory, never its frontmatter name; one without frontmatter keeps its directory name with no description, and one whose frontmatter does not parse is not offered",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const fallbackDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const fallbackHome = path.join(fallbackDir, "claude-home");
      const skillsDir = path.join(fallbackHome, "skills");
      yield* writeSkill(skillsDir, "no-frontmatter", "# Just a heading\n");
      for (const [directoryName, field] of [
        ["broken-yaml", "name: [unclosed"],
        ["broken-tools", "allowed-tools: [Read, Write"],
        ["broken-quoted", 'name: "unclosed: text'],
      ] as const) {
        yield* writeSkill(
          skillsDir,
          directoryName,
          ["---", "description: Run: browser objectives.", field, "---"].join("\n"),
        );
      }
      yield* fs.writeFileString(path.join(skillsDir, "README.md"), "not a skill");
      const fallback = yield* discoverClaudeSkills({ homePath: fallbackHome }, undefined);
      assert.deepEqual(
        fallback.map((skill) => skill.name),
        ["no-frontmatter"],
      );
      assert.equal(fallback[0]?.description, undefined);

      for (const [overrideName, enabled] of [
        ["probe-alias-frontmatter", true],
        ["probe-alias", false],
      ] as const) {
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
        const configDir = path.join(tempDir, "claude-home");
        yield* writeSkill(
          path.join(configDir, "skills"),
          "probe-alias",
          ["---", "name: probe-alias-frontmatter", "---", "", "# Body"].join("\n"),
        );
        yield* fs.writeFileString(
          path.join(configDir, "settings.json"),
          `{ "skillOverrides": { "${overrideName}": "off" } }`,
        );
        const skills = yield* discoverClaudeSkills({ homePath: configDir });
        assert.deepEqual(
          skills.map((skill) => [skill.name, skill.enabled]),
          [["probe-alias", enabled]],
        );
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Drivers/ClaudeSkills.ts | return { enabled: false, userInvocationOnly: false }; → return { enabled: true, userInvocationOnly: false };
it.effect(
  "SK6: A skill a settings file switches off is offered disabled, `user-invocable-only` keeps it on for the person alone, a settings file that does not parse is ignored, and one invalid value drops every override of its file",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const configDir = path.join(tempDir, "claude-home");
      const workspace = path.join(tempDir, "workspace");
      for (const name of ["kept", "off-by-user", "off-by-project"]) {
        yield* writeSkill(
          path.join(configDir, "skills"),
          name,
          ["---", `name: ${name}`, "---", "", "# Body"].join("\n"),
        );
      }
      yield* fs.writeFileString(
        path.join(configDir, "settings.json"),
        '{ "skillOverrides": { "off-by-user": "off", "kept": "on" } }',
      );
      yield* fs.makeDirectory(path.join(workspace, ".claude"), { recursive: true });
      yield* fs.writeFileString(
        path.join(workspace, ".claude", "settings.json"),
        '{ "skillOverrides": { "off-by-project": "off" } }',
      );
      const switchedOff = yield* discoverClaudeSkills({ homePath: configDir }, workspace);
      assert.deepEqual(
        switchedOff.map((skill) => [skill.name, skill.enabled]),
        [
          ["kept", true],
          ["off-by-project", false],
          ["off-by-user", false],
        ],
      );

      const unreadableDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const unreadableHome = path.join(unreadableDir, "claude-home");
      yield* writeSkill(
        path.join(unreadableHome, "skills"),
        "kept",
        ["---", "name: kept", "---", "", "# Body"].join("\n"),
      );
      yield* fs.writeFileString(path.join(unreadableHome, "settings.json"), "{ not json");
      const unreadable = yield* discoverClaudeSkills({ homePath: unreadableHome });
      assert.deepEqual(
        unreadable.map((skill) => [skill.name, skill.enabled]),
        [["kept", true]],
      );

      const userOnlyDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const userOnlyHome = path.join(userOnlyDir, "claude-home");
      yield* writeSkill(
        path.join(userOnlyHome, "skills"),
        "ask-matt",
        ["---", "name: ask-matt", "---", "", "# Body"].join("\n"),
      );
      yield* fs.writeFileString(
        path.join(userOnlyHome, "settings.json"),
        '{ "skillOverrides": { "ask-matt": "user-invocable-only" } }',
      );
      const userOnly = yield* discoverClaudeSkills({ homePath: userOnlyHome });
      assert.deepEqual(
        userOnly.map((skill) => [skill.name, skill.enabled, skill.userInvocationOnly === true]),
        [["ask-matt", true, true]],
      );

      const invalidDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const invalidHome = path.join(invalidDir, "claude-home");
      for (const name of ["unknown-mode", "boolean-false", "sibling-off"]) {
        yield* writeSkill(
          path.join(invalidHome, "skills"),
          name,
          ["---", `name: ${name}`, "---", "", "# Body"].join("\n"),
        );
      }
      yield* fs.writeFileString(
        path.join(invalidHome, "settings.json"),
        '{ "skillOverrides": { "unknown-mode": "some-future-mode", "boolean-false": false, "sibling-off": "off" } }',
      );
      const invalid = yield* discoverClaudeSkills({ homePath: invalidHome });
      assert.deepEqual(
        invalid.map((skill) => [skill.name, skill.enabled]),
        [
          ["boolean-false", true],
          ["sibling-off", true],
          ["unknown-mode", true],
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Drivers/ClaudeSkills.ts | ...(root ? [path.join(root, ".claude", "settings.local.json")] : []), → ...(root ? [path.join(root, ".claude", "settings.json")] : []),
it.effect(
  "SK7: Overrides are read from the user's settings, the workspace's settings and local settings, the repository root's local settings after them, and the administrator's managed policy last, which outranks every other; no ancestor outside a repository is read",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const configDir = path.join(tempDir, "claude-home");
      const repo = path.join(tempDir, "repo");
      const workspace = path.join(repo, "packages", "app");
      for (const name of ["root-off", "root-off-cwd-on", "cwd-off-root-on"]) {
        yield* writeSkill(
          path.join(configDir, "skills"),
          name,
          ["---", `name: ${name}`, "---", "", "# Body"].join("\n"),
        );
      }
      yield* fs.makeDirectory(path.join(repo, ".git"), { recursive: true });
      yield* fs.makeDirectory(path.join(repo, ".claude"), { recursive: true });
      yield* fs.makeDirectory(path.join(workspace, ".claude"), { recursive: true });
      yield* fs.writeFileString(
        path.join(repo, ".claude", "settings.json"),
        '{ "skillOverrides": { "cwd-off-root-on": "off" } }',
      );
      yield* fs.writeFileString(
        path.join(repo, ".claude", "settings.local.json"),
        '{ "skillOverrides": { "root-off": "off", "root-off-cwd-on": "off", "cwd-off-root-on": "on" } }',
      );
      yield* fs.writeFileString(
        path.join(workspace, ".claude", "settings.local.json"),
        '{ "skillOverrides": { "root-off-cwd-on": "on", "cwd-off-root-on": "off" } }',
      );
      const nested = yield* discoverClaudeSkills({ homePath: configDir }, workspace);
      assert.deepEqual(
        nested.map((skill) => [skill.name, skill.enabled]),
        [
          ["cwd-off-root-on", true],
          ["root-off", false],
          ["root-off-cwd-on", false],
        ],
      );

      const outsideDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const outsideHome = path.join(outsideDir, "claude-home");
      const parent = path.join(outsideDir, "not-a-repo");
      yield* writeSkill(
        path.join(outsideHome, "skills"),
        "kept",
        ["---", "name: kept", "---", "", "# Body"].join("\n"),
      );
      yield* fs.makeDirectory(path.join(parent, ".claude"), { recursive: true });
      yield* fs.makeDirectory(path.join(parent, "workspace"), { recursive: true });
      yield* fs.writeFileString(
        path.join(parent, ".claude", "settings.local.json"),
        '{ "skillOverrides": { "kept": "off" } }',
      );
      const outside = yield* discoverClaudeSkills(
        { homePath: outsideHome },
        path.join(parent, "workspace"),
      );
      assert.deepEqual(
        outside.map((skill) => [skill.name, skill.enabled]),
        [["kept", true]],
      );

      const posixPath = yield* Path.Path.pipe(Effect.provide(NodePath.layerPosix));
      const win32Path = yield* Path.Path.pipe(Effect.provide(NodePath.layerWin32));
      for (const [platform, expected] of [
        ["darwin", "/Library/Application Support/ClaudeCode/managed-settings.json"],
        ["linux", "/etc/claude-code/managed-settings.json"],
      ] as const) {
        assert.deepEqual(
          skillOverrideSettingsPaths(posixPath, "/home/.claude", "/workspace", platform, {}),
          [
            "/home/.claude/settings.json",
            "/workspace/.claude/settings.json",
            "/workspace/.claude/settings.local.json",
            expected,
          ],
        );
      }
      assert.deepEqual(
        skillOverrideSettingsPaths(win32Path, "C:\\Users\\me\\.claude", undefined, "win32", {
          PROGRAMDATA: "C:\\ProgramData",
        }).at(-1),
        "C:\\ProgramData\\ClaudeCode\\managed-settings.json",
      );
      assert.deepEqual(
        skillOverrideSettingsPaths(win32Path, "C:\\Users\\me\\.claude", undefined, "win32", {}),
        ["C:\\Users\\me\\.claude\\settings.json"],
      );
      assert.deepEqual(
        skillOverrideSettingsPaths(
          posixPath,
          "/home/.claude",
          "/repo/packages/app",
          "linux",
          {},
          "/repo",
        ),
        [
          "/home/.claude/settings.json",
          "/repo/packages/app/.claude/settings.json",
          "/repo/packages/app/.claude/settings.local.json",
          "/repo/.claude/settings.local.json",
          "/etc/claude-code/managed-settings.json",
        ],
      );
      assert.deepEqual(
        skillOverrideSettingsPaths(posixPath, "/home/.claude", "/repo", "linux", {}, "/repo"),
        [
          "/home/.claude/settings.json",
          "/repo/.claude/settings.json",
          "/repo/.claude/settings.local.json",
          "/etc/claude-code/managed-settings.json",
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Drivers/ClaudeSkills.ts | return cwd ? path.resolve(cwd, environmentConfigDir) : path.resolve(environmentConfigDir); → return path.resolve(environmentConfigDir);
it.effect(
  "SK8: User skills are read from the instance's home path when one is set, else from `CLAUDE_CONFIG_DIR` resolved against the workspace, and a missing home or workspace offers no skill",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const environmentConfigDir = path.join(tempDir, "env-config");
      yield* writeSkill(
        path.join(environmentConfigDir, "skills"),
        "env-skill",
        ["---", "name: env-skill", "description: From env config dir.", "---"].join("\n"),
      );
      const fromEnvironment = yield* discoverClaudeSkills({ homePath: "" }, undefined, {
        CLAUDE_CONFIG_DIR: environmentConfigDir,
      });
      assert.deepEqual(
        fromEnvironment.map((skill) => skill.name),
        ["env-skill"],
      );
      const explicitHome = path.join(tempDir, "explicit-home");
      yield* writeSkill(
        path.join(explicitHome, "skills"),
        "explicit-skill",
        ["---", "name: explicit-skill", "---"].join("\n"),
      );
      const explicit = yield* discoverClaudeSkills({ homePath: explicitHome }, undefined, {
        CLAUDE_CONFIG_DIR: environmentConfigDir,
      });
      assert.deepEqual(
        explicit.map((skill) => skill.name),
        ["explicit-skill"],
      );

      const relativeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const workspace = path.join(relativeDir, "workspace");
      yield* fs.makeDirectory(workspace, { recursive: true });
      yield* writeSkill(
        path.join(workspace, "relative-config", "skills"),
        "relative-skill",
        ["---", "name: relative-skill", "---"].join("\n"),
      );
      const relative = yield* discoverClaudeSkills({ homePath: "" }, workspace, {
        CLAUDE_CONFIG_DIR: "relative-config",
      });
      assert.deepEqual(
        relative.map((skill) => skill.name),
        ["relative-skill"],
      );
      assert.equal(relative[0]?.scope, "user");

      const missingDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      assert.deepEqual(
        yield* discoverClaudeSkills(
          { homePath: path.join(missingDir, "missing-home") },
          path.join(missingDir, "missing-workspace"),
        ),
        [],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Drivers/ClaudeSkills.ts | ...(parseFrontmatterBoolean(record["user-invocable"]) === false → ...(record["user-invocable"] === false
it.effect(
  "SK9: A skill whose frontmatter disables model invocation, in any YAML 1.1 true spelling, is marked for the person alone, and one marked not user-invocable, in any false spelling, is kept out of the person's slash commands",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const configDir = path.join(tempDir, "claude-home");
      const workspace = path.join(tempDir, "workspace");
      yield* writeSkill(
        path.join(workspace, ".claude", "skills"),
        "re-release-version",
        [
          "---",
          "name: re-release-version",
          "description: Move the current tag forward.",
          "disable-model-invocation: true",
          "---",
          "",
          "# Body",
        ].join("\n"),
      );
      yield* writeSkill(
        path.join(workspace, ".claude", "skills"),
        "release-version",
        ["---", "name: release-version", "description: Cut a release.", "---", "", "# Body"].join(
          "\n",
        ),
      );
      const project = yield* discoverClaudeSkills({ homePath: configDir }, workspace);
      assert.equal(
        project.find((skill) => skill.name === "re-release-version")?.userInvocationOnly,
        true,
      );
      assert.equal(
        project.find((skill) => skill.name === "release-version")?.userInvocationOnly,
        undefined,
      );

      const agentOnlyDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const agentOnlyHome = path.join(agentOnlyDir, "claude-home");
      yield* writeSkill(
        path.join(agentOnlyHome, "skills"),
        "agent-only",
        ["---", "name: agent-only", "user-invocable: false", "---", "", "# Body"].join("\n"),
      );
      const agentOnly = yield* discoverClaudeSkills({ homePath: agentOnlyHome });
      assert.deepEqual(
        agentOnly.map((skill) => [skill.name, skill.userInvocable]),
        [["agent-only", false]],
      );

      const spellingsDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-skills-" });
      const spellingsHome = path.join(spellingsDir, "claude-home");
      const skillsDir = path.join(spellingsHome, "skills");
      yield* writeSkill(
        skillsDir,
        "user-only-yes",
        ["---", "disable-model-invocation: yes", "---", "", "# Body"].join("\n"),
      );
      yield* writeSkill(
        skillsDir,
        "agent-only-no",
        ["---", "user-invocable: no", "---", "", "# Body"].join("\n"),
      );
      yield* writeSkill(
        skillsDir,
        "plain-off",
        ["---", "disable-model-invocation: off", "---", "", "# Body"].join("\n"),
      );
      const spellings = yield* discoverClaudeSkills({ homePath: spellingsHome });
      assert.deepEqual(
        spellings.map((skill) => [
          skill.name,
          skill.userInvocationOnly === true,
          skill.userInvocable === false,
        ]),
        [
          ["agent-only-no", false, true],
          ["plain-off", false, false],
          ["user-only-yes", true, false],
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
