import { SearchIcon } from "lucide-react";

import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "~/components/ui/autocomplete";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const SERVICES = ["storefront", "backoffice", "db", "cache", "search"];

function Sample({
  size = "default",
  showTrigger = false,
  showClear = false,
  icon = false,
}: {
  readonly size?: "sm" | "default" | "lg";
  readonly showTrigger?: boolean;
  readonly showClear?: boolean;
  readonly icon?: boolean;
}) {
  return (
    <Autocomplete items={SERVICES}>
      <AutocompleteInput
        aria-label="Service"
        placeholder="Find a service"
        showClear={showClear}
        showTrigger={showTrigger}
        size={size}
        startAddon={icon ? <SearchIcon /> : undefined}
      />
      <AutocompletePopup>
        <AutocompleteEmpty>No service matches.</AutocompleteEmpty>
        <AutocompleteList>
          {(service: string) => (
            <AutocompleteItem key={service} value={service}>
              {service}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}

export default defineKitSection({
  id: "autocomplete",
  title: "Autocomplete",
  purpose: "Free text with suggestions to take or leave.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/autocomplete.tsx",
  render: () => (
    <SpecimenGrid>
      {(["sm", "default", "lg"] as const).map((size) => (
        <Specimen key={size} label={specimenLabel({ size })}>
          <div className="w-56">
            <Sample size={size} />
          </div>
        </Specimen>
      ))}
      <Specimen label="showTrigger showClear">
        <div className="w-56">
          <Sample showClear showTrigger />
        </div>
      </Specimen>
      <Specimen label="startAddon={<SearchIcon />}">
        <div className="w-56">
          <Sample icon />
        </div>
      </Specimen>
    </SpecimenGrid>
  ),
});
