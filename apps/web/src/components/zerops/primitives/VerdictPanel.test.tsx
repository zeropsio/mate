import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { VERDICT_BORDER_CLASS, VerdictPanel } from "./VerdictPanel";

describe("VerdictPanel", () => {
  it.each(["ok", "busy", "attention", "failed", "off"] as const)(
    "wears the %s answer's colour on its own edge",
    (tone) => {
      const html = renderToStaticMarkup(<VerdictPanel text="It can land." tone={tone} />);
      expect(html).toContain(VERDICT_BORDER_CLASS[tone]);
      expect(html).toContain(`data-zerops-status-tone="${tone}"`);
    },
  );

  it("says the answer as a sentence, never as a scanned label", () => {
    const html = renderToStaticMarkup(<VerdictPanel text="The checks passed." tone="ok" />);
    expect(html).toContain("The checks passed.");
    expect(html).not.toContain("micro-label");
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

  it("spends no room on a verb column where there is no verb", () => {
    const html = renderToStaticMarkup(<VerdictPanel text="Merged into main." tone="ok" />);
    expect(html).not.toContain("shrink-0 items-center gap-2");
  });
});
