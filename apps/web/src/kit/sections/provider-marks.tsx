import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "~/components/usage/usageProviders";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

export default defineKitSection({
  id: "provider-marks",
  title: "Provider marks",
  purpose: "An agent's maker, by its own mark: in usage and wherever a provider is named.",
  group: "Chosen",
  kind: "Identity",
  source: "apps/web/src/components/Icons.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock note="An agent's maker, by its own mark." title="Marks">
        <SpecimenGrid>
          {PROVIDER_ORDER.map((provider) => {
            const { mark: Mark, label } = PROVIDER_PRESENTATION[provider];
            return (
              <Specimen
                key={provider}
                label={`PROVIDER_PRESENTATION.${provider}.mark`}
                note={label}
              >
                <Mark className="size-6" />
              </Specimen>
            );
          })}
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
