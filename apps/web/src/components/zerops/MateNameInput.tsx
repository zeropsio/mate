/**
 * A Mate's name, as the New Mate and New project dialogs ask it: the proposed name, taken whole
 * by the first key typed over it, and — where the dialog can propose another — a die at the
 * field's end (board D1) for another name free on the account. A name rolled is a name typed:
 * the face follows it until a pick sticks.
 */
import { DicesIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function MateNameInput({
  id,
  value,
  onValueChange,
  onAnother,
  invalid,
  describedBy,
  label,
  readOnly = false,
}: {
  readonly id: string;
  readonly value: string;
  readonly onValueChange: (typed: string) => void;
  /** Another name, free on the account; absent, no die. */
  readonly onAnother?: (() => void) | undefined;
  readonly invalid: boolean;
  /** The quiet line that says what is wrong with it, or what it waits on. */
  readonly describedBy: string;
  /** Its name for a screen reader, where no visible label names it. */
  readonly label?: string | undefined;
  /** The Mate is on its way: the name reads, and changes no more. */
  readonly readOnly?: boolean;
}) {
  // The proposed name is taken whole by the first key typed over it — once.
  const [selected, setSelected] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        aria-label={label}
        autoComplete="off"
        id={id}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        onFocus={(event) => {
          if (selected) return;
          setSelected(true);
          event.currentTarget.select();
        }}
        placeholder="Name"
        readOnly={readOnly}
        spellCheck={false}
        value={value}
      />
      {onAnother === undefined ? null : (
        <InputGroupAddon align="inline-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Another name"
                  data-zerops-mate-name="another"
                  disabled={readOnly}
                  onClick={onAnother}
                  size="icon-xs"
                  type="button"
                  variant="ghost-muted"
                />
              }
            >
              <DicesIcon />
            </TooltipTrigger>
            <TooltipPopup>Another name</TooltipPopup>
          </Tooltip>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
