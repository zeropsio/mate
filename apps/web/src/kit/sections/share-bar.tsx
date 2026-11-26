import { ShareBar } from "~/components/ui/share-bar";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

const usd = (value: number) => `$${value.toFixed(2)}`;
const tokens = (value: number) => `${(value / 1000).toFixed(0)}K`;

const COST_BY_TYPE = [
  { label: "Uncached input", value: 1.84, color: "var(--color-series-1)" },
  { label: "Cached input", value: 0.62, color: "var(--color-series-2)" },
  { label: "Cache writes", value: 0.4, color: "var(--color-series-3)" },
  { label: "Output", value: 2.9, color: "var(--color-series-4)" },
];
const BALANCE = [
  { label: "Topped up", value: 40, color: "var(--color-spend-compute)" },
  { label: "Promo credit", value: 15, color: "var(--color-spend-tokens)" },
];
const PEOPLE = [
  { label: "Ada", value: 820_000, color: "var(--color-series-1)" },
  { label: "Linus", value: 410_000, color: "var(--color-series-2)" },
  { label: "Grace", value: 120_000, color: "var(--color-series-3)" },
  { label: "Unknown owner", value: 30_000, color: "var(--color-muted-foreground)" },
];

function ShareBarSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Hover a part for its name, amount and share. Empty parts are left out."
        title="With its legend"
      >
        <SpecimenGrid size="lg">
          <Specimen label="legend" note="Cost by type">
            <div className="w-full">
              <ShareBar format={usd} label="Cost by type" legend parts={COST_BY_TYPE} />
            </div>
          </Specimen>
          <Specimen label="legend" note="A balance by where it came from">
            <div className="w-full">
              <ShareBar format={usd} label="Balance" legend parts={BALANCE} />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Where the rows beside it name each part with its own swatch."
        title="The bar alone"
      >
        <SpecimenGrid size="lg">
          <Specimen label="parts={people}" note="Tokens by person">
            <div className="w-full">
              <ShareBar format={tokens} label="Tokens by person" parts={PEOPLE} />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "share-bar",
  title: "ShareBar",
  purpose: "A whole split into its parts, as one bar of series-coloured pills, with its legend.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/share-bar.tsx",
  render: () => <ShareBarSpecimens />,
});
