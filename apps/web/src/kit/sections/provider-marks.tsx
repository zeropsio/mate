import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "~/components/usage/usageProviders";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

export default defineKitSection({
  id: "provider-marks",
  title: "Provider marks",
  purpose: "An agent's maker, by its own mark: in usage and wherever a provider is named.",
  group: "Chosen",
  kind: "Identity",
  source: "apps/web/src/components/Icons.tsx",
  render: () => (
    <SpecimenGrid>
      {PROVIDER_ORDER.map((provider) => {
        const { mark: Mark, label } = PROVIDER_PRESENTATION[provider];
        return (
          <Specimen key={provider} label={label}>
            <Mark className="size-6" />
          </Specimen>
        );
      })}
    </SpecimenGrid>
  ),
});
