/**
 * The Crew tab's composer, at its top: a 48 px pill — "Give the crew
 * something to do…", who it goes to, and a round send. With a lead the chip
 * says "To Lead" (the lead's face; the lead splits it and shows you the plan
 * before anyone starts); without one it is "To" and the crew's faces, each a
 * press, and each one picked gets the message as a task of its own. While a
 * plan waits for Start, what you write changes it. `@` finds the Mate's
 * files. A refusal comes back as its sentence under the pill; the text stays
 * for a fix.
 *
 * For a viewer who may not run the crew (D6), `CrewTellLocked` stands in its
 * place: why, and the one way out, in the pill's own 48 px.
 */
import type { CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import {
  CREW_COMPOSER_PLACEHOLDER,
  CREW_COMPOSER_PLAN_PLACEHOLDER,
  CREW_LOCK_ACTION,
  CREW_TO_LEAD_LINE,
  CREW_TO_PICK_LINE,
  CREW_TO_WORD,
  crewLockWords,
  crewSendToWord,
  crewToWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewCommand, Crewmate, EnvironmentId } from "@t3tools/contracts";
import type { MateMarkState } from "@t3tools/shared/brand";
import { ArrowUpIcon, LockIcon } from "lucide-react";
import { useCallback, useId, useRef, useState, type KeyboardEvent } from "react";

import { useTheme } from "~/hooks/useTheme";
import { useComposerPathSearch } from "~/lib/composerPathSearchState";
import { cn } from "~/lib/utils";

import { ComposerCommandMenu } from "../../chat/ComposerCommandMenu";
import { MateFace } from "../primitives";
import { CrewPress, CrewTip } from "./CrewParts";
import {
  pickTellItem,
  tellMenu,
  tellPayload,
  tellPicks,
  type TellMenuItem,
} from "./CrewTellComposer.logic";

export interface CrewComposerLead {
  readonly name: string;
  readonly tint: Crewmate["tint"];
  readonly face: MateMarkState;
}

export function CrewTellComposer({
  environmentId,
  treeCwd,
  crewmates,
  lead,
  planWaits,
  sending,
  holding = false,
  pickable,
  error,
  onSend,
}: {
  readonly environmentId: EnvironmentId;
  /** The Mate's tree, where `@` finds files; `null` while the Mate's config is unread. */
  readonly treeCwd: string | null;
  /** Who can be picked without a lead: the crew, the faces in their order. */
  readonly crewmates: ReadonlyArray<Crewmate>;
  /** The lead, wearing its face; `null` for a crew without one. */
  readonly lead: CrewComposerLead | null;
  /** The lead's plan waits for Start: what is written changes it. */
  readonly planWaits: boolean;
  readonly sending: boolean;
  /** Whose the crew's logins are is still being read: Send waits for it. */
  readonly holding?: boolean;
  /** Without a lead, whether a face may be picked: a crewmate the viewer may run. */
  readonly pickable?: (handle: string) => boolean;
  /** The last send's refusal, as its sentence. */
  readonly error: string | null;
  /** Whether the engine took it; a taken message clears the pill. */
  readonly onSend: (command: Extract<CrewCommand, { _tag: "tell" }>) => Promise<boolean>;
}) {
  const { resolvedTheme } = useTheme();
  const [text, setText] = useState("");
  const menuListId = `${useId()}-suggestions`;
  const [picked, setPicked] = useState<ReadonlyArray<string>>([]);
  /** Where the caret is while the menu may show; `null` once it is dismissed. */
  const [caret, setCaret] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const search = useComposerPathSearch({
    environmentId,
    cwd: caret === null ? null : treeCwd,
    query: caret === null ? null : (tellMenu(text, caret, [])?.trigger.query ?? null),
  });
  const menu = caret === null ? null : tellMenu(text, caret, search.entries);
  const items = menu?.items ?? [];
  const active = items.find((item) => item.id === highlighted) ?? items[0];

  const pick = useCallback(
    (item: TellMenuItem) => {
      if (menu === null) return;
      const next = pickTellItem(text, menu.trigger, item);
      setText(next.text);
      setCaret(null);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(next.cursor, next.cursor);
      });
    },
    [menu, text],
  );

  const command = tellPayload(text, lead === null ? picked : []);
  const ready = command !== null && !sending && !holding && (lead !== null || picked.length > 0);
  const send = useCallback(() => {
    if (!ready || command === null) return;
    void onSend(command).then((taken) => {
      if (taken) setText("");
    });
  }, [command, onSend, ready]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu !== null && active !== undefined) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const index = items.indexOf(active);
        setHighlighted(items[(index + step + items.length) % items.length]?.id ?? null);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(active);
        return;
      }
    }
    if (event.key === "Escape" && menu !== null) {
      event.preventDefault();
      setCaret(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const placeholder = planWaits ? CREW_COMPOSER_PLAN_PLACEHOLDER : CREW_COMPOSER_PLACEHOLDER;
  return (
    <div className="relative mx-4 mt-4 @max-md:mt-3.5" data-crew-composer>
      <div className="crew-composer">
        <textarea
          aria-label={placeholder}
          className="crew-composer-input"
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          placeholder={placeholder}
          ref={input}
          rows={1}
          value={text}
        />
        {lead === null ? (
          <CrewTip tip={CREW_TO_PICK_LINE}>
            <span className="crew-chip" data-crew-composer-to="">
              {CREW_TO_WORD}
              <span className="flex items-center gap-0.5">
                {crewmates.map((mate) => (
                  <button
                    aria-label={mate.displayName}
                    aria-pressed={picked.includes(mate.handle)}
                    className="crew-pick"
                    disabled={pickable?.(mate.handle) === false}
                    key={mate.handle}
                    onClick={() => setPicked(tellPicks(picked, mate.handle, crewmates))}
                    type="button"
                  >
                    <MateFace className="size-4" size="dot" state="idle" tint={mate.tint} />
                  </button>
                ))}
              </span>
            </span>
          </CrewTip>
        ) : (
          <CrewTip tip={CREW_TO_LEAD_LINE}>
            <span className="crew-chip" data-crew-composer-to="lead">
              <MateFace className="size-4" size="dot" state={lead.face} tint={lead.tint} />
              {crewToWord(lead.name)}
            </span>
          </CrewTip>
        )}
        <button
          aria-label={crewSendToWord(lead?.name ?? null)}
          className="crew-send"
          data-ready={ready ? "" : undefined}
          disabled={!ready}
          onClick={send}
          type="button"
        >
          <ArrowUpIcon aria-hidden="true" className="size-4" strokeWidth={2.2} />
        </button>
      </div>
      {menu === null || items.length === 0 ? null : (
        <div className="absolute inset-x-0 top-full z-10 mt-1">
          <ComposerCommandMenu
            listId={menuListId}
            activeItemId={active?.id ?? null}
            isLoading={search.isPending}
            items={[...items]}
            onHighlightedItemChange={setHighlighted}
            onSelect={(item) => {
              if (item.type === "path") pick(item);
            }}
            resolvedTheme={resolvedTheme}
            triggerKind="crewmate"
          />
        </div>
      )}
      {error === null ? null : (
        <p className="mt-2 px-4.5 text-line text-status-failed-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The composer's place for a viewer who may not run the crew (D6): the lock
 * in the conversation's amber, why in its words with the crew for its agent
 * (`crewLockWords`), and its one way out — in the pill's own 48 px and
 * radius, quiet rather than white since nothing is written here, so nothing
 * under it moves when whose the crew's logins are becomes known.
 */
export function CrewTellLocked({
  lock,
  onSignIn,
  className,
}: {
  readonly lock: CrewLock;
  readonly onSignIn: (lock: CrewLock) => void;
  /** Where it stands: the composer's place, or the empty state's press. */
  readonly className?: string;
}) {
  return (
    <div className={cn("crew-locked", className)} data-crew-locked={lock.ownership}>
      <LockIcon aria-hidden="true" className="size-4 shrink-0 text-warning" />
      <p className="crew-locked-words">{crewLockWords(lock.ownership)}</p>
      <CrewPress tone="quiet" label={CREW_LOCK_ACTION} onPress={() => onSignIn(lock)} />
    </div>
  );
}
