/**
 * A crewmate's menu, from the ⌄ on its pill in the conversation's line: its
 * job's first sentence at the top, then each press with one line under it
 * saying what it does (`CrewmateMenu.logic.ts` says which). *Try its work*
 * and *Stop its app* press `useCrewTry`; *Change its job* and *Change the
 * brief* open the crew's editors where the chat keeps them; *Clear its
 * conversation* starts the crewmate fresh, keeping its job and its work.
 *
 * A crew thread is the engine's: nothing here archives, renames or starts a
 * session of the person's own in it.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { crewMenuFailureWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { EnvironmentId } from "@t3tools/contracts";
import { useId, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { crewCommands } from "~/zerops/crew/crewCommands";
import { useCrew } from "~/zerops/crew/useCrew";
import { crewFailureSentence } from "~/zerops/crew/useCrewCommand";
import { useCrewTry } from "~/zerops/crew/useCrewTry";
import { MenuItem, MenuPopup } from "../../ui/menu";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import {
  crewmateMenuModel,
  type CrewmateMenuItemId,
  type CrewmateMenuModel,
} from "./CrewmateMenu.logic";

/** The menu's popup, as drawn: the job's first sentence, then each press and its line. */
export function CrewmateMenuPopup({
  model,
  onSelect,
}: {
  readonly model: CrewmateMenuModel;
  readonly onSelect: (id: CrewmateMenuItemId) => void;
}) {
  const headingId = useId();
  return (
    <MenuPopup
      align="start"
      aria-describedby={headingId}
      className="w-max max-w-100"
      data-crewmate-menu
    >
      <p className="px-2 pt-1.5 pb-2 text-line text-muted-foreground" id={headingId}>
        {model.heading}
      </p>
      {model.items.map((item) => (
        <MenuItem
          data-crewmate-menu-item={item.id}
          disabled={!item.enabled}
          key={item.id}
          onClick={() => onSelect(item.id)}
        >
          <span className="flex min-w-0 flex-col py-0.5">
            <span>{item.label}</span>
            {item.line === null ? null : (
              <span className="text-xs text-muted-foreground">{item.line}</span>
            )}
          </span>
        </MenuItem>
      ))}
    </MenuPopup>
  );
}

export function CrewmateMenu({
  environmentId,
  handle,
  mateName,
  onEditJob,
  onEditBrief,
}: {
  readonly environmentId: EnvironmentId;
  readonly handle: string;
  readonly mateName: string;
  /** *Change its job*: the crew's Crewmate editor on this crewmate. */
  readonly onEditJob: (handle: string) => void;
  /** *Change the brief*: the crew's Brief editor. */
  readonly onEditBrief: () => void;
}) {
  const { view, current } = useCrew(environmentId);
  const tries = useCrewTry(environmentId, handle);
  const runCommand = useAtomCommand(crewCommands.command, { reportFailure: false });
  const [clearing, setClearing] = useState(false);
  const row = view?.crewmates.find(({ crewmate }) => crewmate.handle === handle);
  if (row === undefined) return null;
  const model = crewmateMenuModel({
    crewmate: row.crewmate,
    mateName,
    tries:
      tries === null
        ? null
        : { where: tries.tries.where, enabled: tries.enabled, stops: tries.stop !== null },
    busy: clearing || !current,
  });

  const clear = async () => {
    setClearing(true);
    const result = await runCommand({ environmentId, input: { _tag: "startFresh", handle } });
    setClearing(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: crewMenuFailureWord("clear", row.crewmate.displayName),
          description: crewFailureSentence(squashAtomCommandFailure(result)),
        }),
      );
    }
  };

  return (
    <CrewmateMenuPopup
      model={model}
      onSelect={(id) => {
        switch (id) {
          case "try":
            tries?.press();
            return;
          case "stop":
            tries?.stop?.();
            return;
          case "job":
            onEditJob(handle);
            return;
          case "brief":
            onEditBrief();
            return;
          case "clear":
            void clear();
            return;
        }
      }}
    />
  );
}
