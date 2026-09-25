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
    expect(panel.slice(0, detail)).toMatch(/text-muted-foreground[^"]*"[^>]*>$/);
  });

  it("sets its detail on its own line under the sentence's text on a phone, not under the dot", () => {
    const html = renderToStaticMarkup(
      <VerdictPanel detail="v0.1.13 · released 1h ago" text="Production runs it." tone="ok" />,
    );
    const line = /<span class="([^"]*)"><span[^>]*data-zerops-status-tone/.exec(html)?.[1] ?? "";
    expect(line.split(" ")).toEqual(expect.arrayContaining(["flex-col", "sm:flex-row"]));
    const detail = /<span class="([^"]*)">v0\.1\.13 · released 1h ago/.exec(html)?.[1] ?? "";
    // The dot (8px) and its gap (6px): the sentence's text starts 14px in.
    expect(detail.split(" ")).toEqual(expect.arrayContaining(["ps-3.5", "sm:ps-0"]));
  });

  it("spends no room on a verb column where there is no verb", () => {
    const html = renderToStaticMarkup(<VerdictPanel text="Merged into main." tone="ok" />);
    expect(html).not.toContain("shrink-0 items-center gap-2");
  });
});
