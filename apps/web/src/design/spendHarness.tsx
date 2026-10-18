/**
 * A project's spend, from fixtures: the overview card's line at 400 px and the project page's card
 * at 440 px, each loaded, a real zero and reading. "Unknown" renders nothing, so it has no case.
 *
 * Served by the dev server at `/design-spend.html` (`?theme=dark`).
 *
 * Fixtures only. Nothing here ships — `design-spend.html` is not `index.html`, and no route
 * imports this module.
 */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { Card } from "~/components/ui/card";
import {
  ProjectSpendCardView,
  ProjectSpendLineView,
} from "~/components/zerops/projects/ProjectSpend";
import { joinSpend, type SpendState } from "~/components/zerops/projects/projectSpend.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";

const TODAY = "2026-10-18";
const DAYS = Array.from({ length: 30 }, (_, at) =>
  new Date(Date.parse("2026-09-19T00:00:00.000Z") + at * 86_400_000).toISOString().slice(0, 10),
);
// Tea Shop: steady compute, tokens that follow the automated Mates' working days; today so far.
const compute = DAYS.map((_, at) => (at === 29 ? 0.21 : 0.55 + ((at * 7) % 5) * 0.03));
const tokens = DAYS.map((_, at) =>
  at === 29
    ? 0.63
    : [5, 6, 12, 13, 19, 20, 26, 27].includes(at)
      ? 0.3
      : 1.2 + ((at * 11) % 7) * 0.22,
);
const loaded = (
  computeUsd: ReadonlyArray<number>,
  tokensUsd: ReadonlyArray<number>,
): SpendState => ({
  kind: "loaded",
  series: joinSpend(
    { days: DAYS, usd: computeUsd },
    new Map(DAYS.map((day, at) => [day, tokensUsd[at] ?? 0])),
    TODAY,
  ),
});
const TEA_SHOP = loaded(compute, tokens);
// PlayWisely, set up today: nothing billed before it.
const SETTING_UP = loaded(
  DAYS.map((_, at) => (at === 29 ? 0.21 : 0)),
  DAYS.map((_, at) => (at === 29 ? 0.63 : 0)),
);
const ZERO = loaded(
  DAYS.map(() => 0),
  DAYS.map(() => 0),
);
const LOADING: SpendState = { kind: "loading" };

function Case({
  title,
  width,
  children,
}: {
  readonly title: string;
  readonly width: number;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" style={{ width }}>
      <h2 className="text-caption font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** The line as an overview card holds it: inside a card's padding. */
function LineCard({ children }: { readonly children: ReactNode }) {
  return (
    <Card size="md">
      <span className="text-emphasis font-semibold text-foreground">Tea Shop</span>
      {children}
    </Card>
  );
}

function Harness() {
  return (
    <div className="min-h-screen bg-background px-8 py-10 text-foreground">
      <div className="flex flex-wrap items-start gap-10">
        <div className="flex flex-col gap-8">
          <Case title="Line · running" width={400}>
            <LineCard>
              <ProjectSpendLineView state={TEA_SHOP} />
            </LineCard>
          </Case>
          <Case title="Line · set up today" width={400}>
            <LineCard>
              <ProjectSpendLineView state={SETTING_UP} />
            </LineCard>
          </Case>
          <Case title="Line · no spend" width={400}>
            <LineCard>
              <ProjectSpendLineView state={ZERO} />
            </LineCard>
          </Case>
          <Case title="Line · reading" width={400}>
            <LineCard>
              <ProjectSpendLineView state={LOADING} />
            </LineCard>
          </Case>
        </div>
        <div className="flex flex-col gap-8">
          <Case title="Card · running, two Mates on a subscription" width={440}>
            <ProjectSpendCardView
              state={TEA_SHOP}
              subscriptionMates={[
                { name: "Raya", provider: "Claude" },
                { name: "Vera", provider: "Claude" },
              ]}
            />
          </Case>
          <Case title="Card · reading" width={440}>
            <ProjectSpendCardView state={LOADING} />
          </Case>
        </div>
        <div className="flex flex-col gap-8">
          <Case title="Card · set up today" width={440}>
            <ProjectSpendCardView state={SETTING_UP} />
          </Case>
          <Case title="Card · no spend" width={440}>
            <ProjectSpendCardView state={ZERO} />
          </Case>
        </div>
      </div>
    </div>
  );
}

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
