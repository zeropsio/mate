/**
 * *Add crew ports* (PRD §5.7): a block of ports on one dev service, one per
 * crewmate there, each with its own URL. The engine reserves the ports
 * (`addCrewPorts`) and never deploys (MA-6); the press sends Fen the message
 * that declares them in zerops.yaml and redeploys the service once, so this
 * dialog is that message's confirmation and says what the redeploy does.
 */
import { CREW_PORTS_MAX } from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../../ui/number-field";

const DEFAULT_CREW_PORTS = 4;

export function CrewPortsDialog({
  host,
  onOpenChange,
  mateName,
  pending,
  error,
  onConfirm,
}: {
  /** The dev service; `null` closes the dialog. */
  readonly host: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly mateName: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onConfirm: (host: string, count: number) => void;
}) {
  const [count, setCount] = useState(DEFAULT_CREW_PORTS);
  return (
    <Dialog onOpenChange={onOpenChange} open={host !== null}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add crew ports</DialogTitle>
          <DialogDescription>
            {`Adds ${count} ${count === 1 ? "port" : "ports"} to ${host ?? ""}'s dev setup in zerops.yaml and redeploys ${host ?? ""} once. The redeploy replaces the container, so do it before the crew starts; lanes that already exist come back from their branches. The zerops.yaml change ships with your next pull request.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            <span className="block text-sm font-medium text-foreground">Crew ports</span>
            <NumberField
              max={CREW_PORTS_MAX}
              min={1}
              onValueChange={(value) => setCount(value ?? DEFAULT_CREW_PORTS)}
              value={count}
            >
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput aria-label="Crew ports" />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
            <p className="text-xs text-muted-foreground">{`At most ${CREW_PORTS_MAX}.`}</p>
            {error === null ? null : (
              <p className="text-xs text-status-failed-text" role="alert">
                {error}
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose
            render={
              <Button size="sm" variant="ghost">
                Cancel
              </Button>
            }
          />
          <Button
            disabled={pending || host === null}
            onClick={() => {
              if (host !== null) onConfirm(host, count);
            }}
            size="sm"
          >
            {`Ask ${mateName} to add them`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
