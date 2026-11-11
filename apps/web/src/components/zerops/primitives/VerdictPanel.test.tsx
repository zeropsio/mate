import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { VerdictPanel } from "./VerdictPanel";

describe("VerdictPanel", () => {
  it("says the answer as a sentence, never as a scanned label", () => {
    const html = renderToStaticMarkup(<VerdictPanel text="The checks passed." tone="ok" />);
    expect(html).toContain("The checks passed.");
  });

  it("keeps the verb in the same element as the sentence it acts on", () => {
    const html = renderToStaticMarkup(
      <VerdictPanel text="1 change is not live here." tone="busy">
        <button type="button">Release</button>
      </VerdictPanel>,
    );
    const panel = html.slice(html.indexOf('data-zerops-primitive="verdict-panel"'));
    expect(panel).toContain(">Release</button>");
  });

  it("says its detail inside the panel, muted, after the sentence", () => {
    const html = renderToStaticMarkup(
      <VerdictPanel
        detail="v0.1.27 · released 1h ago"
        text="Production already runs what is merged."
        tone="ok"
      />,
    );
    const panel = html.slice(html.indexOf('data-zerops-primitive="verdict-panel"'));
    const sentence = panel.indexOf("Production already runs what is merged.");
    const detail = panel.indexOf("v0.1.27 · released 1h ago");
    expect(sentence).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(sentence);
  });
});
