import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TurnTally } from "./TurnHeader";

describe("TurnTally", () => {
  it("renders nothing before anything has settled", () => {
    expect(renderToStaticMarkup(<TurnTally items={[]} />)).toBe("");
  });

  it.each([
    {
      name: "a service's deploy and verify",
      item: {
        key: "service:nextstorestage",
        subject: "nextstorestage",
        facts: [
          { word: "Deployed", tone: "ok" as const },
          { word: "Healthy", tone: "ok" as const },
        ],
      },
      dots: ["ok:Deployed", "ok:Healthy"],
      plain: [],
    },
    {
      name: "browser checks with errors",
      item: {
        key: "browser",
        subject: null,
        facts: [
          { word: "3 browser checks", tone: "attention" as const },
          { word: "1 with errors", tone: "failed" as const },
        ],
      },
      dots: ["attention:3 browser checks", "failed:1 with errors"],
      plain: [],
    },
    {
      name: "asks",
      item: { key: "asks", subject: null, facts: [{ word: "2 asks", tone: null }] },
      dots: [],
      plain: ["2 asks"],
    },
  ])("writes $name as a status dot beside each word it carries", ({ item, dots, plain }) => {
    const html = renderToStaticMarkup(<TurnTally items={[item]} />);
    const rendered = [
      ...html.matchAll(
        /data-zerops-status-tone="([a-z]+)"><span aria-hidden="true"[^>]*><\/span><span[^>]*>([^<]+)<\/span>/g,
      ),
    ].map(([, tone, word]) => `${tone}:${word}`);

    expect(rendered).toEqual(dots);
    for (const word of plain) expect(html).toContain(`<span>${word}</span>`);
    if (item.subject) expect(html).toContain(`>${item.subject}</span>`);
  });
});
