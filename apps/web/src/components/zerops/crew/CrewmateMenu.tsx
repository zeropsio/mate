/**
 * A crewmate's menu, from the ⌄ on its pill in the conversation's line: its
 * job's first sentence at the top, then each press with one line under it
 * saying what it does (`CrewmateMenu.logic.ts` says which). *Try its work*
 * and *Stop its app* press `useCrewTry`; *Change its job* and *Change the
 * goal* open the Crew tab on that view; *Clear its conversation* starts the
 * crewmate fresh, keeping its job and its work. The Crew tab's rows draw the
 * same popup, with *Remove from the crew* after a separator.
 *
 * A crew thread is the engine's: nothing here archives, renames or starts a
 * session of the person's own in it. For a crewmate the viewer may not run
 * (D6), the menu says why under the job, and offers only *Try its work*
 * where it opens what already runs.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { crewMenuFailureWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { EnvironmentId } from "@t3tools/contracts";
import { LockIcon } from "lucide-react";
import { Fragment, useId, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { crewCommands } from "~/zerops/crew/crewCommands";
import { useCrew } from "~/zerops/crew/useCrew";
import { useCrewAccess } from "~/zerops/crew/useCrewAccess";
import { crewFailureSentence } from "~/zerops/crew/useCrewCommand";
import { useCrewTry } from "~/zerops/crew/useCrewTry";
import { MenuItem, MenuPopup, MenuSeparator } from "../../ui/menu";
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
  from = "line",
}: {
  readonly model: CrewmateMenuModel;
  readonly onSelect: (id: CrewmateMenuItemId) => void;
  /**
   * Under the ⌄ on the conversation's line it opens from the start, as wide as
   * its words; under a Crew tab row's ··· from the end, at the tab's 364.
   */
  readonly from?: "line" | "row";
}) {
  const headingId = useId();
  return (
    <MenuPopup
      align={from === "row" ? "end" : "start"}
      aria-describedby={headingId}
      className={from === "row" ? "w-91" : "w-max max-w-100"}
      data-crewmate-menu
    >
      <p className="px-2.75 pt-1.5 pb-2 text-line text-muted-foreground" id={headingId}>
        {model.heading}
      </p>
      {model.notice === null ? null : (
        <p
          className="flex items-start gap-2 border-t border-border/60 px-2.75 pt-2 pb-1.5 text-line text-foreground/85"
          data-crewmate-menu-notice
        >
          <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {model.notice}
        </p>
      )}
      {model.items.map((item) => (
        <Fragment key={item.id}>
          {item.id === "remove" ? <MenuSeparator /> : null}
          <MenuItem
            data-crewmate-menu-item={item.id}
            disabled={!item.enabled}
            onClick={() => onSelect(item.id)}
            variant={item.id === "remove" ? "destructive" : "default"}
          >
            <span className="flex min-w-0 flex-col px-0.75 py-0.75">
              <span>{item.label}</span>
              {item.line === null ? null : (
                <span className="text-xs text-muted-foreground">{item.line}</span>
              )}
            </span>
          </MenuItem>
        </Fragment>
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
  /** *Change its job*: the Crew tab on this crewmate's job. */
  readonly onEditJob: (handle: string) => void;
  /** The lead's *Change the goal*: the Crew tab on the crew's goal. */
  readonly onEditBrief: () => void;
}) {
  const { snapshot, view, current } = useCrew(environmentId);
  const access = useCrewAccess(environmentId, snapshot);
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
        : {
            where: tries.tries.where,
            enabled: tries.enabled,
            stops: tries.stop !== null,
            offered: tries.offered,
          },
    busy: clearing || !current || access.reading,
    lock: access.crewmate(handle),
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
          case "goal":
            onEditBrief();
            return;
          case "clear":
            void clear();
            return;
          case "remove":
            return;
        }
      }}
    />
  );
}
