/**
 * A person's role, as their own page and the invitation set it — legacy Zerops's *Role preset*:
 * four cards (Owner, Admin, Developer, Guest), each saying what it gives; then *Advanced*, the
 * Zerops role and its three flags, which opens by itself where the membership is no preset. A card
 * or a role the editor may not give is disabled; a flag Zerops holds for the role is locked, the
 * lock saying why.
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

import { Switch } from "../ui/switch";
import { ToggleGroup, Toggle } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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
  return (
    <div className="tm-role" data-zerops-surface="team-role">
      <span className="tm-label" id={`${id}-preset`}>
        Role preset
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
        <span>Advanced</span>
        {advanced.custom === null ? null : (
          <span className="tm-advanced-custom">· {advanced.custom}</span>
        )}
      </button>
      {shown ? (
        <div className="tm-advanced" id={`${id}-advanced`}>
          <span className="tm-label">Role</span>
          <ToggleGroup
            aria-label="Zerops role"
            onValueChange={(next) => {
              const roleCode = next[0] as OrgRoleCode | undefined;
              if (roleCode !== undefined && roleCode !== value.roleCode)
                onChange(withRole(editorRole, value, roleCode));
            }}
            value={[value.roleCode]}
          >
            {advanced.roles.map((role) => (
              <Tooltip key={role.roleCode}>
                <TooltipTrigger
                  render={
                    <Toggle
                      aria-label={role.label}
                      disabled={role.disabled}
                      value={role.roleCode}
                    />
                  }
                >
                  {role.label}
                </TooltipTrigger>
                <TooltipPopup>
                  {role.disabled && role.reason !== null
                    ? `${role.reason}. ${role.description}`
                    : role.description}
                </TooltipPopup>
              </Tooltip>
            ))}
          </ToggleGroup>
          <span className="tm-label">Role flags</span>
          <div className="tm-flags">
            {advanced.flags.map((flag) => (
              <label className="tm-flag" data-disabled={flag.disabled || undefined} key={flag.flag}>
                <Switch
                  checked={flag.checked}
                  disabled={flag.disabled}
                  onCheckedChange={(checked) =>
                    onChange(settledMembership(editorRole, { ...value, [flag.flag]: checked }))
                  }
                />
                <span>{flag.label}</span>
                {flag.reason === null ? null : (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span aria-label={flag.reason} className="tm-flag-lock" />}
                    >
                      <LockIcon aria-hidden="true" className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipPopup>{flag.reason}</TooltipPopup>
                  </Tooltip>
                )}
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
