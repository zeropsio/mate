import type { ComponentProps } from "react";

import { RadioCard, RadioGroup } from "~/components/ui/radio-group";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type RadioLayout = NonNullable<ComponentProps<typeof RadioGroup>["layout"]>;
type CardAlign = NonNullable<ComponentProps<typeof RadioCard>["align"]>;

const LAYOUTS = variantsOf<RadioLayout>({ stack: true, columns: true, row: true });
const ALIGNS = variantsOf<CardAlign>({ start: true, center: true });

const ROLES = [
  { value: "owner", name: "Owner", line: "Everything, billing and the team included." },
  { value: "admin", name: "Admin", line: "Every project and its Mates; invites people." },
  { value: "developer", name: "Developer", line: "Works in the projects you give them." },
  { value: "guest", name: "Guest", line: "Follows the work and opens the app." },
] as const;

export default definePlayground({
  section: "radio-group",
  name: "RadioCard",
  imports: 'import { RadioCard, RadioGroup } from "~/components/ui/radio-group";',
  controls: {
    layout: {
      kind: "enum",
      options: LAYOUTS,
      note: "columns two to a row; row for like tiles side by side",
    },
    align: { kind: "enum", options: ALIGNS, note: "center for a row of like tiles" },
    ownerDisabled: { kind: "boolean", note: "a role this person cannot give" },
  },
  initial: { layout: "columns", align: "start", ownerDisabled: true },
  render: ({ layout, align, ownerDisabled }) => (
    <div className="w-150">
      <RadioGroup aria-label="Role" defaultValue="developer" layout={layout}>
        {ROLES.map((role) => (
          <RadioCard
            align={align}
            disabled={ownerDisabled && role.value === "owner"}
            key={role.value}
            title={role.name}
            value={role.value}
          >
            {role.line}
          </RadioCard>
        ))}
      </RadioGroup>
    </div>
  ),
  jsx: ({ layout, align, ownerDisabled }) =>
    jsxElement(
      "RadioGroup",
      { "aria-label": "Role", defaultValue: "developer", layout },
      ROLES.map((role) =>
        jsxElement(
          "RadioCard",
          {
            value: role.value,
            title: role.name,
            align,
            disabled: ownerDisabled && role.value === "owner",
          },
          role.line,
          { align: "start", disabled: false },
        ),
      ).join("\n"),
      { layout: "stack" },
    ),
  usage: {
    do: [
      "Use cards when each option needs its line: a role, a plan, a region.",
      "Keep the lines to one quiet sentence each, the same shape on every card.",
      "Disable an option the person cannot choose rather than hiding it.",
    ],
    dont: [
      "Put a press or a link inside a card: the card itself is the choice.",
      "Use cards for short words a plain Radio list says as well.",
    ],
  },
});
