/**
 * A person's role, as their own page and the invitation set it — legacy Zerops's presets, labelled *Role*:
 * four cards (Owner, Admin, Developer, Guest), each saying what it gives; then *Advanced*, a panel
 * the cards' width of Settings rows — the Zerops role as a select, each of its three flags as a
 * switch — which opens by itself where the membership is no preset. A card or a role the editor
 * may not give is disabled; a flag Zerops holds for the role is locked, the row saying why.
 *
 * A pure view: the membership arrives, each choice goes back as the whole membership it makes.
 */
import {
  presetMembership,
  settledMembership,
  withRole,
  type OrgMembership,
  type OrgRoleCode,
} from "@t3tools/client-runtime/zerops/teamRoles";
import { BanIcon, ChevronDownIcon, LockIcon } from "lucide-react";
import { useId, useState } from "react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { advancedChoices, roleCards } from "./teamMember.logic";

export function TeamRoleEditor({
  editorRole,
  value,
  editable,
  onChange,
}: {
  /** The viewer's own organization role: what they may give. */
  readonly editorRole: string | undefined;
  readonly value: OrgMembership;
  /** The viewer may change this person's role; else everything reads, nothing presses. */
  readonly editable: boolean;
  readonly onChange: (next: OrgMembership) => void;
}) {
  const id = useId();
  const cards = roleCards(editorRole, value, editable);
  const advanced = advancedChoices(editorRole, value, editable);
  const [open, setOpen] = useState(advanced.custom !== null);
  // A combination no card names opens Advanced by itself; it never closes it.
  const shown = open || advanced.custom !== null;
  const current = advanced.roles.find(({ roleCode }) => roleCode === value.roleCode);
  return (
    <div className="tm-role" data-zerops-surface="team-role">
      <span className="tm-label" id={`${id}-preset`}>
        Role
      </span>
      <div aria-labelledby={`${id}-preset`} className="tm-role-cards" role="radiogroup">
        {cards.map((card) => (
          <button
            aria-checked={card.selected}
            className="tm-role-card"
            data-selected={card.selected || undefined}
            disabled={card.disabled}
            key={card.role}
            onClick={() => onChange(presetMembership(card.role))}
            role="radio"
            type="button"
          >
            <span className="tm-role-card-name">
              {card.disabled && editable ? (
                <BanIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
              ) : null}
              {card.label}
            </span>
            <span className="tm-role-card-text">{card.description}</span>
          </button>
        ))}
      </div>
      <button
        aria-controls={`${id}-advanced`}
        aria-expanded={shown}
        className="tm-advanced-toggle"
        onClick={() => setOpen(!shown)}
        type="button"
      >
        <ChevronDownIcon aria-hidden="true" className="size-4" data-open={shown || undefined} />
        <span>Fine-tune permissions</span>
        {advanced.custom === null ? null : (
          <span className="tm-advanced-custom">· {advanced.custom}</span>
        )}
      </button>
      {shown ? (
        <div className="tm-advanced" id={`${id}-advanced`}>
          <div className="tm-advanced-row">
            <span className="tm-advanced-text">
              <span className="tm-advanced-title" id={`${id}-zerops-role`}>
                Zerops role
              </span>
              <span className="tm-advanced-desc">{current?.description}</span>
            </span>
            <span className="tm-advanced-control">
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
          </div>
          {advanced.flags.map((flag) => (
            <label
              className="tm-advanced-row"
              data-disabled={flag.disabled || undefined}
              key={flag.flag}
            >
              <span className="tm-advanced-text">
                <span className="tm-advanced-title">
                  {flag.label}
                  {flag.reason === null ? null : (
                    <LockIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  )}
                </span>
                {flag.reason === null ? null : (
                  <span className="tm-advanced-desc">{flag.reason}</span>
                )}
              </span>
              <Switch
                checked={flag.checked}
                disabled={flag.disabled}
                onCheckedChange={(checked) =>
                  onChange(settledMembership(editorRole, { ...value, [flag.flag]: checked }))
                }
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
