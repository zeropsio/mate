/**
 * *Tell the crew* (PRD §4.3 item 7): one line that grows, `@` offering the
 * crew's crewmates by face, handle and job. With a lead the send reads
 * *Send to lead*. What the engine refuses — no mention and no lead — comes
 * back as its sentence under the line; the text stays for a fix.
 */
import type { CrewCommand, Crewmate } from "@t3tools/contracts";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";

import { useTheme } from "~/hooks/useTheme";

import { ComposerCommandMenu } from "../../chat/ComposerCommandMenu";
import { Textarea } from "../../ui/textarea";
import { Pill } from "../primitives";
import { pickCrewmate, tellMenu, tellPayload, type TellMenu } from "./CrewTellComposer.logic";

export function CrewTellComposer({
  crewmates,
  hasLead,
  sending,
  error,
  onSend,
}: {
  readonly crewmates: ReadonlyArray<Crewmate>;
  readonly hasLead: boolean;
  readonly sending: boolean;
  /** The last send's refusal, as its sentence. */
  readonly error: string | null;
  /** Whether the engine took it; a taken message clears the line. */
  readonly onSend: (command: Extract<CrewCommand, { _tag: "tell" }>) => Promise<boolean>;
}) {
  const { resolvedTheme } = useTheme();
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<TellMenu | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const follow = useCallback(
    (nextText: string, cursor: number) => {
      const nextMenu = tellMenu(nextText, cursor, crewmates);
      setMenu(nextMenu);
      setHighlighted(nextMenu?.items[0]?.id ?? null);
    },
    [crewmates],
  );

  const pick = useCallback(
    (handle: string) => {
      if (menu === null) return;
      const next = pickCrewmate(text, menu.trigger, handle);
      setText(next.text);
      setMenu(null);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(next.cursor, next.cursor);
      });
    },
    [menu, text],
  );

  const send = useCallback(() => {
    const command = tellPayload(text, crewmates);
    if (command === null || sending) return;
    void onSend(command).then((taken) => {
      if (taken) setText("");
    });
  }, [crewmates, onSend, sending, text]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const items = menu?.items ?? [];
    if (menu !== null && items.length > 0) {
      const index = Math.max(
        0,
        items.findIndex((item) => item.id === highlighted),
      );
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlighted(items[(index + step + items.length) % items.length]?.id ?? null);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const item = items[index];
        if (item !== undefined) pick(item.handle);
        return;
      }
    }
    if (event.key === "Escape" && menu !== null) {
      event.preventDefault();
      setMenu(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="space-y-1.5" data-crew-tell>
      <div className="relative flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Textarea
            aria-label="Tell the crew"
            onChange={(event) => {
              setText(event.target.value);
              follow(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onSelect={(event) => follow(text, event.currentTarget.selectionStart)}
            placeholder="Tell the crew… use @ to address"
            ref={input}
            rows={1}
            size="sm"
            value={text}
          />
          {menu === null ? null : (
            <div className="absolute inset-x-0 top-full z-10 mt-1">
              <ComposerCommandMenu
                activeItemId={highlighted}
                isLoading={false}
                items={[...menu.items]}
                onHighlightedItemChange={setHighlighted}
                onSelect={(item) => {
                  if (item.type === "crewmate") pick(item.handle);
                }}
                resolvedTheme={resolvedTheme}
                triggerKind="crewmate"
              />
            </div>
          )}
        </div>
        <Pill
          disabled={sending || text.trim() === ""}
          label={hasLead ? "Send to lead" : "Send"}
          onClick={send}
          size="sm"
        />
      </div>
      {error === null ? null : (
        <p className="text-xs text-status-failed-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
