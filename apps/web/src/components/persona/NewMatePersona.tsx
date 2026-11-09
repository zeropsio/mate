/**
 * The add-Mate dialog's persona: how the new Mate works with its person, from the templates its
 * Persona page offers. HQ keeps it with the stand-up ask and the Mate's server takes it at its
 * stand-up, so its first turn already works that way.
 */
import type { MatePersona } from "@t3tools/contracts";
import { PREMADE_PERSONA_TEMPLATES } from "@t3tools/shared/personaTemplates";
import type { LucideIcon } from "lucide-react";
import { useId, useMemo } from "react";

import { Label } from "../ui/label";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useOrgPersonaTemplates } from "~/zerops/usePersonaTemplates";
import {
  mateIn,
  mateLeads,
  personaFromTemplate,
  personaTemplateGroups,
  type PersonaTemplateRow,
} from "./PersonaPanel.logic";
import { personaIcon } from "./personaIcon";

const NONE = "none";

const rowIcon = (row: PersonaTemplateRow) =>
  personaIcon({ source: row.source, id: row.template.id, revision: row.template.revision });

function Glyph(props: { readonly icon: LucideIcon }) {
  const Icon = props.icon;
  return <Icon aria-hidden="true" />;
}

export function NewMatePersona(props: {
  /** The Mate's name as typed; blank while none is. */
  readonly mate: string;
  readonly persona: MatePersona | null;
  readonly onChange: (persona: MatePersona | null) => void;
}) {
  const id = useId();
  const org = useOrgPersonaTemplates();
  // Only groups with templates: the dialog says nothing of a list it cannot offer.
  const groups = useMemo(
    () =>
      personaTemplateGroups(PREMADE_PERSONA_TEMPLATES, org).filter(
        (group) => group.rows.length > 0,
      ),
    [org],
  );
  const rows = groups.flatMap((group) => group.rows);
  const ref = props.persona?.template;
  const value = ref === undefined ? NONE : `${ref.source}:${ref.id}`;
  const row = rows.find((candidate) => candidate.key === value);
  const mate = props.mate === "" ? null : props.mate;
  const items: Record<string, string> = {
    [NONE]: "No persona",
    ...Object.fromEntries(rows.map((candidate) => [candidate.key, candidate.template.name])),
    // One chosen before its organization's list dropped it keeps its name.
    ...(props.persona === null || row !== undefined ? {} : { [value]: props.persona.name }),
  };

  return (
    <section
      aria-labelledby={`${id}-label`}
      className="flex flex-col gap-1"
      data-zerops-surface="new-mate-persona"
    >
      {/* The picker's words end on the section's end edge, as the access section's button does. */}
      <div className="-me-2.5 flex min-h-7 items-center justify-between gap-3">
        <Label id={`${id}-label`} render={<h3 />}>
          How {mateIn(mate)} works with you
        </Label>
        <Select
          items={items}
          modal={false}
          onValueChange={(next: string | null) => {
            const picked = rows.find((candidate) => candidate.key === next);
            props.onChange(
              picked === undefined ? null : personaFromTemplate(picked.source, picked.template),
            );
          }}
          value={value}
        >
          <SelectTrigger
            aria-describedby={`${id}-line`}
            aria-labelledby={`${id}-label`}
            size="sm"
            variant="ghost"
          >
            {props.persona === null ? null : <Glyph icon={personaIcon(ref)} />}
            <SelectValue />
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            <SelectItem value={NONE}>No persona</SelectItem>
            {groups.map((group) => (
              <SelectGroup key={group.key}>
                <SelectGroupLabel>{group.title}</SelectGroupLabel>
                {group.rows.map((candidate) => (
                  <SelectItem key={candidate.key} value={candidate.key}>
                    <span className="inline-flex items-center gap-2">
                      <Glyph icon={rowIcon(candidate)} />
                      {candidate.template.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <p className="text-body text-muted-foreground text-pretty" id={`${id}-line`}>
        {props.persona === null
          ? `${mateLeads(mate)} works its own way. You can give it a persona later.`
          : (row?.template.description ?? props.persona.name)}
      </p>
    </section>
  );
}
