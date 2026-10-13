// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- certifies Vitest's selected smoke cases.
import * as NodePath from "node:path";
import type { Reporter } from "vite-plus/test/node";

type Selections = Readonly<Record<string, ReadonlyArray<string>>>;

/** A selected file passing cannot hide a missing, skipped or failing smoke case. */
export default class GateSmokeReporter implements Reporter {
  private readonly root: string;
  private readonly selections: Selections;

  constructor({
    root = NodePath.resolve(import.meta.dirname, ".."),
    selections = JSON.parse(process.env.MATE_GATE_SMOKE_CASES ?? "{}") as Selections,
  }: { root?: string; selections?: Selections } = {}) {
    this.root = root;
    this.selections = selections;
  }

  onTestRunEnd(
    modules: ReadonlyArray<{
      moduleId: string;
      children: {
        allTests(): Iterable<{ fullName: string; result(): { state: string } }>;
      };
    }>,
  ): void {
    for (const [file, titles] of Object.entries(this.selections)) {
      const module = modules.find((module) => module.moduleId === NodePath.join(this.root, file));
      const tests = module ? [...module.children.allTests()] : [];
      for (const title of titles) {
        const matches = tests.filter(
          (test) => test.fullName === title || test.fullName.endsWith(` > ${title}`),
        );
        if (!matches.length) throw new Error(`Missing selected smoke case: ${file}: ${title}`);
        if (matches.some((test) => test.result().state !== "passed"))
          throw new Error(`Smoke case did not pass: ${file}: ${title}`);
      }
    }
  }
}
