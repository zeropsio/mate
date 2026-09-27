/**
 * *Tell the crew* (PRD §4.3 item 7): one line that grows, `@` offering the
 * crew's crewmates by face, handle and job, then the files of your tree. With
 * a lead the send reads *Send to lead*. What the engine refuses — no mention
 * and no lead — comes back as its sentence under the line; the text stays for
 * a fix.
 */
import type { CrewCommand, Crewmate, EnvironmentId } from "@t3tools/contracts";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";

import { useTheme } from "~/hooks/useTheme";
import { useComposerPathSearch } from "~/lib/composerPathSearchState";

import { detectComposerTrigger } from "../../../composer-logic";
import { ComposerCommandMenu } from "../../chat/ComposerCommandMenu";
import { Textarea } from "../../ui/textarea";
import { Pill } from "../primitives";
import { pickTellItem, tellMenu, tellPayload, type TellMenuItem } from "./CrewTellComposer.logic";

export function CrewTellComposer({
  environmentId,
  treeCwd,
  crewmates,
  hasLead,
  sending,
  error,
  onSend,
}: {
  readonly environmentId: EnvironmentId;
  /** Your tree, where `@` finds files; `null` while the Mate's config is unread. */
  readonly treeCwd: string | null;
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
  /** Where the caret is while the menu may show; `null` once it is dismissed. */
  const [caret, setCaret] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const trigger =
    caret === null ? null : detectComposerTrigger(text, caret, { mentions: "crewmate" });
  const search = useComposerPathSearch({
    environmentId,
    cwd: trigger === null ? null : treeCwd,
    query: trigger === null ? null : trigger.query,
  });
  const menu = caret === null ? null : tellMenu(text, caret, crewmates, search.entries);
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

  const send = useCallback(() => {
    const command = tellPayload(text, crewmates);
    if (command === null || sending) return;
    void onSend(command).then((taken) => {
      if (taken) setText("");
    });
  }, [crewmates, onSend, sending, text]);

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

  return (
    <div className="space-y-1.5" data-crew-tell>
      <div className="relative flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Textarea
            aria-label="Tell the crew"
            onChange={(event) => {
              setText(event.target.value);
              setCaret(event.target.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            placeholder="Tell the crew… use @ to address"
            ref={input}
            rows={1}
            size="sm"
            value={text}
          />
          {menu === null ? null : (
            <div className="absolute inset-x-0 top-full z-10 mt-1">
              <ComposerCommandMenu
                activeItemId={active?.id ?? null}
                isLoading={search.isPending}
                items={[...items]}
                onHighlightedItemChange={setHighlighted}
                onSelect={(item) => {
                  if (item.type === "crewmate" || item.type === "path") pick(item);
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
