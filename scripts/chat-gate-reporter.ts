// @effect-diagnostics nodeBuiltinImport:off -- scopes certification to CI's server inventory.
import * as NodePath from "node:path";
import type { Reporter } from "vite-plus/test/node";
import { chatGateStages, chatGateTestFiles } from "./chat-gate.ts";

/** Every boundary case must actually pass; expected failures and omissions cannot certify a port. */
export default class ChatGateReporter implements Reporter {
  private readonly serverFiles: ReadonlySet<string> | undefined;

  constructor({ server = process.env.MATE_CHAT_GATE_SERVER === "1" }: { server?: boolean } = {}) {
    if (server) {
      const root = NodePath.resolve(import.meta.dirname, "..");
      this.serverFiles = new Set(
        chatGateTestFiles(
          root,
          chatGateStages.filter((stage) => ["A", "E", "F"].includes(stage.id)),
        )
          .filter((file) => file.startsWith("apps/server/"))
          .map((file) => NodePath.join(root, file)),
      );
    }
  }

  onTestRunEnd(
    modules: ReadonlyArray<{
      moduleId: string;
      children: {
        allTests(): Iterable<{
          fullName: string;
          options: { fails: boolean | undefined };
          result(): { state: string };
        }>;
      };
    }>,
  ): void {
    if (modules.length === 0) {
      // Global setup unwinds through this hook; throwing here would replace its original error.
      // Fail even with passWithNoTests, while leaving startup diagnostics to Vitest.
      process.exitCode = 1;
      return;
    }
    const serverFiles = this.serverFiles;
    const selected = serverFiles
      ? modules.filter((module) => serverFiles.has(module.moduleId))
      : modules;
    // Spread-sharding can assign no boundary files to a shard; its other server cases still run.
    if (selected.length === 0) return;
    const tests = selected.flatMap((module) => [...module.children.allTests()]);
    const uncertified = tests.filter(
      (test) => test.options.fails || test.result().state !== "passed",
    );
    if (tests.length === 0 || uncertified.length > 0)
      throw new Error(
        `Chat contract gate requires passing cases: ${uncertified.map((test) => test.fullName).join(", ") || "no cases ran"}`,
      );
  }
}
