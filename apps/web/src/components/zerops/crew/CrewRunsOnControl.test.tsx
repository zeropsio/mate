import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CrewRunsOnControl } from "./CrewRunsOnControl";

describe("CrewRunsOnControl", () => {
  it("says what the crewmate runs on, as a way into its editor", () => {
    const html = renderToStaticMarkup(
      <CrewRunsOnControl label="Runs on Claude Code · Haiku 4.5 · high" onEdit={() => {}} />,
    );
    expect(html).toContain("data-crew-runs-on");
    expect(html).toContain("Runs on Claude Code · Haiku 4.5 · high");
    expect(html).toMatch(/<button[^>]*data-crew-runs-on/u);
    expect(html).toContain(
      'aria-label="Runs on Claude Code · Haiku 4.5 · high — edit in the crewmate editor"',
    );
  });
});
