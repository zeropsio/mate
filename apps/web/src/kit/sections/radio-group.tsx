import { useState } from "react";

import { Label } from "~/components/ui/label";
import {
  Radio,
  RadioCard,
  RadioGroup,
  RadioSwatch,
  RadioSwatchGroup,
} from "~/components/ui/radio-group";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";

function Choices({ disabled = false }: { readonly disabled?: boolean }) {
  return (
    <RadioGroup aria-label="Who can open it" defaultValue="team" disabled={disabled}>
      <Label>
        <Radio value="team" />
        The team
      </Label>
      <Label>
        <Radio value="public" />
        Anyone with the address
      </Label>
      <Label>
        <Radio disabled value="nobody" />
        Nobody (disabled item)
      </Label>
    </RadioGroup>
  );
}

const ROLES = [
  { value: "owner", name: "Owner", line: "Everything, billing and the team included." },
  {
    value: "admin",
    name: "Admin",
    line: "Every project and its Mates; invites people. No billing.",
  },
  { value: "developer", name: "Developer", line: "Works in the projects you give them." },
  { value: "guest", name: "Guest", line: "Follows the work and opens the app." },
] as const;

const REGIONS = [
  { value: "prg1", name: "EU Central", city: "Prague", latency: "Latency: 54 ms" },
  { value: "ny1", name: "US East", city: "New York", latency: "Latency: 145 ms" },
  { value: "sea1", name: "US West", city: "Seattle", latency: "" },
] as const;

const TINTS = ["coral", "amber", "olive", "sky", "violet", "rose", "sand", "slate"] as const;
type Tint = (typeof TINTS)[number];

function Swatches() {
  const [tint, setTint] = useState<Tint>("sky");
  return (
    <div className="w-80">
      <RadioSwatchGroup
        aria-label="Color"
        className="flex justify-between"
        onValueChange={setTint}
        options={TINTS}
        value={tint}
      >
        {TINTS.map((option) => (
          <RadioSwatch
            aria-label={option}
            key={option}
            style={{ color: `var(--zerops-mate-tint-${option})` }}
            value={option}
          >
            <svg aria-hidden="true" viewBox="0 0 36 36">
              <circle
                cx="18"
                cy="18"
                data-slot="radio-swatch-ring"
                fill="none"
                r="15.5"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle cx="18" cy="18" fill="currentColor" r="12" />
            </svg>
          </RadioSwatch>
        ))}
      </RadioSwatchGroup>
    </div>
  );
}

export default defineKitSection({
  id: "radio-group",
  title: "RadioGroup",
  purpose: "One choice from a short list, every option in view.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/radio-group.tsx",
  render: () => (
    <div className="flex flex-col gap-8">
      <SpecimenGrid>
        <Specimen label='<RadioGroup defaultValue="team">'>
          <Choices />
        </Specimen>
        <Specimen label="<RadioGroup disabled>">
          <Choices disabled />
        </Specimen>
      </SpecimenGrid>
      <SpecimenBlock title="Cards">
        <SpecimenGrid>
          <Specimen label='<RadioGroup layout="columns"> <RadioCard title>'>
            <div className="w-136">
              <RadioGroup aria-label="Role" defaultValue="developer" layout="columns">
                {ROLES.map((role) => (
                  <RadioCard
                    disabled={role.value === "owner"}
                    key={role.value}
                    title={role.name}
                    value={role.value}
                  >
                    {role.line}
                  </RadioCard>
                ))}
              </RadioGroup>
            </div>
          </Specimen>
          <Specimen label='<RadioGroup layout="row"> <RadioCard align="center">'>
            <div className="w-116">
              <RadioGroup aria-label="Region" defaultValue="prg1" layout="row">
                {REGIONS.map((region) => (
                  <RadioCard
                    align="center"
                    key={region.value}
                    title={region.name}
                    value={region.value}
                  >
                    <span>{region.city}</span>
                    <span className="mt-2 block min-h-4.5">{region.latency}</span>
                  </RadioCard>
                ))}
              </RadioGroup>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Swatches">
        <SpecimenGrid>
          <Specimen label="<RadioSwatchGroup options value> <RadioSwatch>">
            <Swatches />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  ),
});
