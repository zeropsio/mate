import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CrewLeadBar } from "./CrewLeadBar";

describe("CrewLeadBar", () => {
  it("says what the lead does where a writer's chat shows its copy of the code", () => {
    const html = renderToStaticMarkup(<CrewLeadBar />);
    expect(html).toContain("data-crew-lead-bar");
    expect(html).toContain("Plans and reviews · no copy of the code");
  });
});
