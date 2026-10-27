import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProjectSpendSectionView } from "./ProjectSpend";
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

describe("a project's spend card on its page", () => {
  it("shows the figure, the average, the window's ends and what the figure is made of", () => {
    const shown = text(
      renderToStaticMarkup(
        <ProjectSpendSectionView
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
      text(renderToStaticMarkup(<ProjectSpendSectionView state={loaded(18.2, 46.1)} />)),
    ).not.toContain("subscription");
  });

  it("says there was no spend for a real zero", () => {
    expect(text(renderToStaticMarkup(<ProjectSpendSectionView state={loaded(0, 0)} />))).toBe(
      "Spend No spend in the last 30 days",
    );
  });

  it("holds its place with a skeleton while it reads", () => {
    const html = renderToStaticMarkup(<ProjectSpendSectionView state={{ kind: "loading" }} />);
    expect(html).toContain('aria-busy="true"');
    expect(text(html)).toBe("Spend");
  });

  it("shows nothing at all while the spend is unknown", () => {
    expect(renderToStaticMarkup(<ProjectSpendSectionView state={{ kind: "unknown" }} />)).toBe("");
  });
});
