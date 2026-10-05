import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PipelineStepList } from "./PipelineStepList";

// A step reads by its plain name in every state, its mark saying how it
// stands (the owner, 2026-10-05: "it should be steps, but they should be
// visible … no … long texts"): a reader without the mark hears the
// state after it, and a step says how long it took only once it ended — one
// clock ticks, the line's.
describe("PipelineStepList", () => {
  it.each([
    {
      id: "INIT_BUILD_CONTAINER",
      state: "finished",
      name: "Build container",
      said: "Done",
      ms: 12_000,
      took: "12s",
    },
    {
      id: "RUN_BUILD_COMMANDS",
      state: "running",
      name: "Build",
      said: "Running",
      ms: 30_000,
      took: "",
    },
    {
      id: "RUN_PREPARE_COMMANDS",
      state: "waiting",
      name: "Prepare runtime",
      said: "Waiting",
      ms: undefined,
      took: "",
    },
    { id: "DEPLOY", state: "failed", name: "Deploy", said: "Failed", ms: 56_000, took: "56s" },
  ] as const)("reads a $state step by its name: $name", ({ id, state, name, said, ms, took }) => {
    const text = renderToStaticMarkup(
      <PipelineStepList
        aria-label="Pipeline"
        steps={[
          {
            id,
            state,
            sentence: "Running build commands from zerops.yml",
            ...(ms === undefined ? {} : { durationMs: ms }),
          },
        ]}
      />,
    ).replace(/<[^>]+>/gu, "");
    expect(text).toBe(`${name} · ${said}${took}`);
  });

  it("stands what belongs to a step at its line's end, and why it broke under it", () => {
    const html = renderToStaticMarkup(
      <PipelineStepList
        after={{ RUN_BUILD_COMMANDS: <span data-way>Log</span> }}
        aria-label="Pipeline"
        beneath={{ DEPLOY: <span data-why>It crashed at start.</span> }}
        steps={[
          { id: "RUN_BUILD_COMMANDS", state: "finished", sentence: "", durationMs: 41_000 },
          { id: "DEPLOY", state: "failed", sentence: "", durationMs: 56_000 },
        ]}
      />,
    );
    const build = html.slice(0, html.indexOf('data-zerops-pipeline-step="DEPLOY"'));
    const deploy = html.slice(html.indexOf('data-zerops-pipeline-step="DEPLOY"'));
    expect(build).toContain("data-way");
    expect(build.indexOf("data-way")).toBeLessThan(build.indexOf("41s"));
    expect(deploy).toContain("data-why");
    expect(build).not.toContain("data-why");
  });
});
