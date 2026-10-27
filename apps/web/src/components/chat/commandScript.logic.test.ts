import { describe, expect, it } from "vite-plus/test";

import { commandGrammars, grammarsReady } from "./commandScript.logic";

const noScripts = () => [];

describe("command highlighting readiness", () => {
  it("a streamed delta in the same grammar keeps the colours", () => {
    const loaded = new Set(["shellscript"]);
    const before = commandGrammars("pnpm install", noScripts);
    const after = commandGrammars("pnpm install --frozen-lockfile", noScripts);

    expect(grammarsReady(before, loaded)).toBe(true);
    expect(grammarsReady(after, loaded)).toBe(true);
  });

  it("waits for a script's own grammar when a delta brings one", () => {
    const loaded = new Set(["shellscript"]);
    const heredoc = commandGrammars("python3 - <<'PY'\nprint(1)\nPY", () => [
      { language: "python" },
    ]);

    expect(heredoc).toEqual(["shellscript", "python"]);
    expect(grammarsReady(heredoc, loaded)).toBe(false);
  });

  it("is not ready before the shell parser has loaded", () => {
    expect(grammarsReady(null, new Set(["shellscript"]))).toBe(false);
  });
});
