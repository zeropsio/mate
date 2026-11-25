/**
 * A person's role, as their own page and the invitation set it — legacy Zerops's presets, labelled *Role*:
 * four cards (Owner, Admin, Developer, Guest), each saying what it gives, and on a member whose role
 * no preset names a fifth, the membership they hold; then *Advanced*, a panel
 * the cards' width of Settings rows — the Zerops role as a select, each of its three flags as a
 * switch — which opens by itself where the membership is no preset. A card or a role the editor
 * may not give is disabled; a flag Zerops holds for the role is locked, the row saying why.
 *
 * A pure view: the membership arrives, each choice goes back as the whole membership it makes.
 */
import {
  settledMembership,
  withRole,
  type OrgMembership,
  type OrgRoleCode,
} from "@t3tools/client-runtime/zerops/teamRoles";
import { BanIcon, ChevronDownIcon, LockIcon } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { RadioCard, RadioGroup } from "../ui/radio-group";
import { Row } from "../ui/row";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { advancedChoices, roleCards } from "./teamMember.logic";
import { SectionHeader } from "../ui/section";
import { List } from "~/components/ui/list";

export function TeamRoleEditor({
  editorRole,
  held,
  value,
  editable,
  onChange,
}: {
  /** The viewer's own organization role: what they may give. */
  readonly editorRole: string | undefined;
  /** The membership the member holds now; none on an invitation. */
  readonly held?: OrgMembership;
  readonly value: OrgMembership;
  /** The viewer may change this person's role; else everything reads, nothing presses. */
  readonly editable: boolean;
  readonly onChange: (next: OrgMembership) => void;
}) {
  const id = useId();
  const cards = roleCards(editorRole, value, editable, held);
  const advanced = advancedChoices(editorRole, value, editable, held);
  const [open, setOpen] = useState(advanced.custom !== null);
  // A combination no card names opens Advanced by itself; it never closes it.
  const shown = open || advanced.custom !== null;
  const current = advanced.roles.find(({ roleCode }) => roleCode === value.roleCode);
  return (
    <div className="grid gap-2.5" data-zerops-surface="team-role">
      <SectionHeader id={`${id}-preset`} title="Role" />
      <RadioGroup
        aria-labelledby={`${id}-preset`}
        layout="columns"
        onValueChange={(picked) => {
          const card = cards.find((candidate) => candidate.card === picked);
          if (card !== undefined) onChange(card.membership);
        }}
        value={cards.find((card) => card.selected)?.card ?? null}
      >
        {cards.map((card) => (
          <RadioCard
            className="min-h-24 max-sm:min-h-0"
            disabled={card.disabled}
            key={card.card}
            title={
              <>
                {card.disabled && editable ? (
                  <BanIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                ) : null}
                {card.label}
              </>
            }
            value={card.card}
          >
            {card.description}
          </RadioCard>
        ))}
      </RadioGroup>
      <Button
        aria-controls={`${id}-advanced`}
        aria-expanded={shown}
        className="-ms-2 justify-self-start"
        onClick={() => setOpen(!shown)}
        size="sm"
        variant="ghost-muted"
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={cn("size-4 transition-transform duration-200", shown && "rotate-180")}
        />
        <span>Fine-tune permissions</span>
        {advanced.custom === null ? null : <span className="font-normal">· {advanced.custom}</span>}
      </Button>
      {shown ? (
        <div
          // The cards' width, Settings rows inside, a hairline between them; a quiet press's
          // hover is the lift's own accent, a step under it.
          className="rounded-card bg-muted px-1.5 [--accent:color-mix(in_oklab,var(--foreground)_6%,var(--muted))]"
          id={`${id}-advanced`}
        >
          <List>
            <div className="block py-1.5">
              <Row
                control={
                  <span className="ms-3 flex w-44">
                    <Select
                      onValueChange={(next) => {
                        const roleCode = next as OrgRoleCode | null;
                        if (roleCode !== null && roleCode !== value.roleCode)
                          onChange(withRole(editorRole, value, roleCode));
                      }}
                      value={value.roleCode}
                    >
                      <SelectTrigger aria-labelledby={`${id}-zerops-role`} size="sm">
                        <SelectValue>{current?.label}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        {advanced.roles.map((role) => (
                          <SelectItem
                            disabled={role.disabled}
                            hideIndicator
                            key={role.roleCode}
                            value={role.roleCode}
                          >
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </span>
                }
                line={current?.description}
                lineWraps
                size="sm"
                title={<span id={`${id}-zerops-role`}>Zerops role</span>}
              />
            </div>
            {advanced.flags.map((flag) => (
              <label
                className={cn("block py-1.5", !flag.disabled && "cursor-pointer")}
                key={flag.flag}
              >
                <Row
                  badges={
                    flag.reason === null ? undefined : (
                      <LockIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                    )
                  }
                  control={
                    <span className="ms-3 flex">
                      <Switch
                        checked={flag.checked}
                        disabled={flag.disabled}
                        onCheckedChange={(checked) =>
                          onChange(
                            settledMembership(editorRole, { ...value, [flag.flag]: checked }),
                          )
                        }
                      />
                    </span>
                  }
                  line={flag.reason ?? undefined}
                  lineWraps
                  size="sm"
                  // A choice its role holds reads quieter than one the person may change.
                  title={
                    <span className={flag.disabled ? "text-muted-foreground" : "text-foreground"}>
                      {flag.label}
                    </span>
                  }
                />
              </label>
            ))}
          </List>
        </div>
      ) : null}
    </div>
  );
}
