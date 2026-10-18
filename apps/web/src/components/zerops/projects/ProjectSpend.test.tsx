import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProjectSpendCardView, ProjectSpendLineView } from "./ProjectSpend";
import { joinSpend, type SpendState } from "./projectSpend.logic";

const DAYS = Array.from({ length: 30 }, (_, at) =>
  new Date(Date.parse("2026-09-19T00:00:00.000Z") + at * 86_400_000).toISOString().slice(0, 10),
);
const TODAY = "2026-10-18";
const loaded = (computeUsd: number, tokensUsd: number): SpendState => ({
  kind: "loaded",
  series: joinSpend(
    { days: DAYS, usd: DAYS.map(() => computeUsd / 30) },
    new Map(DAYS.map((day) => [day, tokensUsd / 30])),
    TODAY,
  ),
});
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("a project's spend line on its overview card", () => {
  it("shows the 30-day cost and a bar a day", () => {
    const html = renderToStaticMarkup(<ProjectSpendLineView state={loaded(18.2, 46.1)} />);
    expect(text(html)).toContain("$64 .30 30-day cost");
    expect(html.match(/data-slot="tooltip-trigger"/g)).toHaveLength(30);
  });

  it("shows $0.00 with its empty days for a real zero", () => {
    expect(text(renderToStaticMarkup(<ProjectSpendLineView state={loaded(0, 0)} />))).toContain(
      "$0 .00 30-day cost",
    );
  });

  it("keeps its room while it reads, and says no figure", () => {
    const html = renderToStaticMarkup(<ProjectSpendLineView state={{ kind: "loading" }} />);
    expect(html).toContain('aria-busy="true"');
    expect(text(html)).toBe("");
  });

  it("renders nothing, keeping no room, when the spend cannot be read", () => {
    expect(renderToStaticMarkup(<ProjectSpendLineView state={{ kind: "unknown" }} />)).toBe("");
  });
});

describe("a project's spend card on its page", () => {
  it("shows the figure, the average, the window's ends and what the figure is made of", () => {
    const shown = text(
      renderToStaticMarkup(
        <ProjectSpendCardView
          state={loaded(18.2, 46.1)}
          subscriptionMates={[
            { name: "Raya", provider: "Claude" },
            { name: "Vera", provider: "Claude" },
          ]}
        />,
      ),
    );
    expect(shown).toContain("Spend $64 .30 30-day cost");
    expect(shown).toContain("19 Sep avg $2.14 a day Today");
    expect(shown).toContain("Compute · Zerops $18.20");
    expect(shown).toContain("Model tokens · Nebius $46.10");
    expect(shown).toContain(
      "Raya and Vera run on a Claude subscription; it is not in this figure.",
    );
  });

  it("names no subscription when no Mate runs on one", () => {
    expect(
      text(renderToStaticMarkup(<ProjectSpendCardView state={loaded(18.2, 46.1)} />)),
    ).not.toContain("subscription");
  });

  it("says there was no spend for a real zero", () => {
    expect(text(renderToStaticMarkup(<ProjectSpendCardView state={loaded(0, 0)} />))).toBe(
      "Spend No spend in the last 30 days",
    );
  });

  it("holds its place with a skeleton while it reads", () => {
    const html = renderToStaticMarkup(<ProjectSpendCardView state={{ kind: "loading" }} />);
    expect(html).toContain('aria-busy="true"');
    expect(text(html)).toBe("Spend");
  });

  it("shows nothing at all while the spend is unknown", () => {
    expect(renderToStaticMarkup(<ProjectSpendCardView state={{ kind: "unknown" }} />)).toBe("");
  });
});
