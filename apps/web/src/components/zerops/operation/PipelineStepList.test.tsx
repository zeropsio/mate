import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PipelineStepList } from "./PipelineStepList";

// A step's sentence says a finished step in the past ("Initialized build
// container"): a screen reader heard "· Done" after it on every step (run 9).
// A state the sentence does not say — waiting, failed — is still said.
describe("PipelineStepList", () => {
  it.each([
    { state: "finished", sentence: "Initialized build container", said: null },
    { state: "waiting", sentence: "Run build commands from zerops.yml", said: "Waiting" },
    { state: "failed", sentence: "Run build commands from zerops.yml", said: "Failed" },
  ] as const)(
    "says a $state step's state only where its words do not",
    ({ state, sentence, said }) => {
      const text = renderToStaticMarkup(
        <PipelineStepList
          aria-label="Pipeline"
          steps={[{ id: "INIT_BUILD_CONTAINER", state, sentence }]}
        />,
      ).replace(/<[^>]+>/gu, "");
      expect(text).toBe(said === null ? sentence : `${sentence} · ${said}`);
    },
  );
});
