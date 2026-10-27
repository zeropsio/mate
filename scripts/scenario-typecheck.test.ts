// @effect-diagnostics nodeBuiltinImport:off - exercises the installed compiler against the scenario configuration.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

const compiler = NodeURL.fileURLToPath(
  new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);
const scenarioConfig = NodeURL.fileURLToPath(
  new URL("../apps/web/test/scenarios/tsconfig.json", import.meta.url),
);

describe("Decision: no test deleted or weakened; no gate exit-code masking.", () => {
  it.each([
    {
      title: "accepts source directives while allowing scenario globals",
      source: "",
      diagnostic: "",
      status: 0,
    },
    {
      title: "rejects unsuppressed source globals",
      source: "console.log('source');",
      diagnostic: "effect(globalConsole)",
      status: 1,
    },
    {
      title: "rejects TypeScript errors",
      source: "const value: number = 'invalid';",
      diagnostic: "TS2322",
      status: 1,
    },
  ])("$title", ({ source, diagnostic, status }) => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-scenario-tc-"));
    // Overrides retain the defining tsconfig's directory even when a fixture extends it.
    const scenarios = NodeFS.mkdtempSync(
      NodePath.join(NodePath.dirname(scenarioConfig), "typecheck-fixture-"),
    );
    // The plugin scans literal directive text even inside template strings.
    const directive = ["// @effect", "diagnostics-next-line"].join("-");
    try {
      NodeFS.writeFileSync(
        NodePath.join(directory, "source.ts"),
        `${directive} globalTimers:off
setTimeout(() => {}, 0);
${directive} globalFetch:off
fetch('https://example.com');
${directive} globalDate:off
Date.now();
${directive} globalConsole:off
console.log('source');
${source}
`,
      );
      NodeFS.writeFileSync(
        NodePath.join(scenarios, "check.ts"),
        `import ${JSON.stringify(NodePath.relative(scenarios, NodePath.join(directory, "source.ts")))};
setTimeout(() => {}, 0);
fetch('https://example.com');
Date.now();
console.log('scenario');
`,
      );
      const config = NodePath.join(scenarios, "tsconfig.json");
      NodeFS.writeFileSync(
        config,
        JSON.stringify({ extends: scenarioConfig, include: ["**/*.ts"] }),
      );
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [compiler, "--noEmit", "-p", config],
        {
          encoding: "utf8",
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(status);
      expect(result.stdout).not.toContain("TS377000");
      if (diagnostic) expect(result.stdout).toContain(diagnostic);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
      NodeFS.rmSync(scenarios, { recursive: true, force: true });
    }
  });
});
