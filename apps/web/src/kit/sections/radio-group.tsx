import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Label } from "~/components/ui/label";
import {
  Radio,
  RadioCard,
  RadioGroup,
  RadioRow,
  RadioSwatch,
  RadioSwatchGroup,
} from "~/components/ui/radio-group";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

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

const REPOSITORIES = [
  { value: "acme/storefront", line: "Private · connected now", badge: null },
  { value: "acme/storefront-api", line: "Private · name matches", badge: "Suggested" },
  { value: "acme/marketing", line: "Another project holds it", badge: null },
] as const;

const EFFORTS = [
  { value: "low", name: "Low", meta: null },
  { value: "medium", name: "Medium", meta: "Default" },
  { value: "high", name: "High", meta: null },
] as const;

const TINTS = ["coral", "amber", "olive", "sky", "violet", "rose", "sand", "slate"] as const;
type Tint = (typeof TINTS)[number];

function Swatches() {
  const [tint, setTint] = useState<Tint>("sky");
  return (
    <div className="w-full max-w-80">
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
    <Specimens>
      <SpecimenBlock title="Choices">
        <SpecimenGrid size="md">
          <Specimen label='<RadioGroup defaultValue="team">' note="One item disabled">
            <Choices />
          </Specimen>
          <Specimen label="<RadioGroup disabled>">
            <Choices disabled />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="A choice with words of its own, laid out in columns or a row."
        title="Cards"
      >
        <SpecimenGrid size="xl">
          <Specimen
            label='<RadioGroup layout="columns"> · <RadioCard title>'
            note="Roles, the owner's disabled"
          >
            <div className="w-full max-w-136">
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
          <Specimen label='<RadioGroup layout="row"> · <RadioCard align="center">' note="Regions">
            <div className="w-full max-w-116">
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
      <SpecimenBlock
        note="A choice from a list too long or too wordy for cards: the radio leads, the row presses."
        title="Rows"
      >
        <SpecimenGrid size="lg">
          <Specimen
            label='<RadioGroup layout="list"> · <RadioRow title line badges>'
            note="A repository to connect, one taken"
          >
            <div className="w-full max-w-96">
              <RadioGroup aria-label="Repository" defaultValue="acme/storefront" layout="list">
                {REPOSITORIES.map((repository) => (
                  <RadioRow
                    badges={
                      repository.badge === null ? undefined : (
                        <Badge tone="info">{repository.badge}</Badge>
                      )
                    }
                    disabled={repository.value === "acme/marketing"}
                    key={repository.value}
                    line={repository.line}
                    title={repository.value}
                    value={repository.value}
                  />
                ))}
              </RadioGroup>
            </div>
          </Specimen>
          <Specimen label='<RadioRow size="xs" meta>' note="An effort, in a popup">
            <div className="w-full max-w-64">
              <RadioGroup aria-label="Effort" defaultValue="medium" layout="list">
                {EFFORTS.map((effort) => (
                  <RadioRow
                    key={effort.value}
                    meta={effort.meta ?? undefined}
                    size="xs"
                    title={effort.name}
                    value={effort.value}
                  />
                ))}
              </RadioGroup>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Swatches">
        <SpecimenGrid size="lg">
          <Specimen label="<RadioSwatchGroup options value> · <RadioSwatch>" note="A Mate's colour">
            <Swatches />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
