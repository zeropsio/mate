/**
 * What is not live yet, in one quiet warning block: one line per item — a fact and its fix —
 * that opens the row it names, and a closing line by who makes them live: beside a Mate, the Mate
 * with the next message; in an environment without one, a restart per service, confirmed first.
 * Items grow in and fold away on their own; the first paint shows what is there without motion.
 */
import type { VaultNotLive as VaultNotLiveItem } from "@t3tools/client-runtime/data";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { Link2Icon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { MateFace } from "../primitives";
import { notLiveClosing, notLiveId, notLiveWords, RESTART_CONFIRM } from "./vault.logic";
import { VaultWords } from "./VaultRow";

const LEAVE_MS = 240;

interface Shown<T> {
  readonly id: string;
  readonly item: T;
  readonly leaving: boolean;
}

/** The list as it was and is: an item that left stays a moment where it was, marked leaving. */
function usePresence<T>(
  items: ReadonlyArray<T>,
  idOf: (item: T) => string,
): ReadonlyArray<Shown<T>> {
  const ids = items.map(idOf).join("\n");
  const [state, setState] = useState(() => ({
    ids,
    shown: items.map((item): Shown<T> => ({ id: idOf(item), item, leaving: false })),
  }));
  if (state.ids !== ids) {
    const shown = items.map((item): Shown<T> => ({ id: idOf(item), item, leaving: false }));
    const kept = new Set(shown.map((entry) => entry.id));
    state.shown.forEach((entry, index) => {
      if (!kept.has(entry.id))
        shown.splice(Math.min(index, shown.length), 0, { ...entry, leaving: true });
    });
    setState({ ids, shown });
  }
  const leaving = state.shown
    .filter((entry) => entry.leaving)
    .map((entry) => entry.id)
    .join("\n");
  useEffect(() => {
    if (leaving === "") return;
    const gone = new Set(leaving.split("\n"));
    const timer = setTimeout(
      () =>
        setState((current) => ({
          ...current,
          shown: current.shown.filter((entry) => !(entry.leaving && gone.has(entry.id))),
        })),
      LEAVE_MS,
    );
    return () => clearTimeout(timer);
  }, [leaving]);
  const current = new Map(items.map((item) => [idOf(item), item]));
  return state.shown.map((entry) =>
    entry.leaving ? entry : { ...entry, item: current.get(entry.id) ?? entry.item },
  );
}

export interface VaultNotLiveProps {
  readonly items: ReadonlyArray<VaultNotLiveItem>;
  readonly actor: "mate" | "environment";
  readonly mate: {
    readonly name: string;
    readonly tint: MateTintId;
    readonly shape?: MateShapeId | undefined;
  } | null;
  readonly monograms: ReadonlyMap<string, string>;
  readonly restarting: ReadonlySet<string>;
  readonly onOpen: (item: VaultNotLiveItem) => void;
  readonly onRestart: (serviceId: string, hostname: string) => void;
}

export function VaultNotLive(props: VaultNotLiveProps) {
  const shown = usePresence(props.items, notLiveId);
  // What is there at the first paint is drawn still; what arrives after grows in.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.setAttribute("data-vault-settled", ""), []);
  const live = props.items.length > 0;
  const restarts = props.items.filter(
    (item): item is Extract<VaultNotLiveItem, { kind: "restart" }> => item.kind === "restart",
  );
  return (
    <div ref={root}>
      {shown.length === 0 && !live ? null : (
        <div className="vault-fold" data-leaving={live ? undefined : ""}>
          <div>
            <section
              aria-label="Not live yet"
              className="mx-4 mb-2.5 rounded-lg bg-warning-surface pt-2.25 pb-1"
              data-vault-notlive
            >
              <h3 className="px-3 pb-0.75 font-semibold text-2xs text-warning-foreground">
                Not live yet
              </h3>
              <div className="grid">
                {shown.map(({ id, item, leaving }) => {
                  const words = notLiveWords(item);
                  const bad = item.kind === "missing" || item.kind === "self";
                  return (
                    <div className="vault-fold" data-leaving={leaving ? "" : undefined} key={id}>
                      <div>
                        <button
                          className="vault-notlive-item grid w-full grid-cols-[16px_minmax(0,1fr)] gap-x-2.25 px-3 py-1.25 text-left text-line leading-4.75 text-foreground transition-colors"
                          data-vault-notlive-item={id}
                          onClick={() => props.onOpen(item)}
                          type="button"
                        >
                          {item.kind === "restart" ? (
                            <RotateCwIcon
                              aria-hidden="true"
                              className="mt-[2.5px] size-3.5 text-warning-foreground"
                            />
                          ) : bad ? (
                            <TriangleAlertIcon
                              aria-hidden="true"
                              className="mt-[2.5px] size-3.5 text-warning-foreground"
                            />
                          ) : (
                            <Link2Icon
                              aria-hidden="true"
                              className="mt-[2.5px] size-3.5 text-warning-foreground"
                            />
                          )}
                          <span>
                            <VaultWords parts={words.fact} />
                            <span className="text-muted-foreground"> — {words.fix}</span>
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {props.actor === "mate" && props.mate !== null ? (
                <div className="mx-3 mt-1 flex min-h-10 items-center gap-2 border-t border-warning/25 py-1 text-xs text-muted-foreground">
                  <MateFace
                    className="size-4"
                    shape={props.mate.shape}
                    size="dot"
                    state="idle"
                    tint={props.mate.tint}
                  />
                  <span>{notLiveClosing(props.items.length, props.mate.name)}</span>
                </div>
              ) : restarts.length > 0 ? (
                <div className="mx-3 mt-1 grid border-t border-warning/25 py-1">
                  {restarts.map((item) => (
                    <RestartLine
                      hostname={item.hostname}
                      key={item.serviceId}
                      monogram={props.monograms.get(item.hostname) ?? item.hostname.slice(0, 1)}
                      onRestart={() => props.onRestart(item.serviceId, item.hostname)}
                      restarting={props.restarting.has(item.serviceId)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function RestartLine(props: {
  readonly hostname: string;
  readonly monogram: string;
  readonly restarting: boolean;
  readonly onRestart: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="grid gap-1.5 py-1" data-vault-restart={props.hostname}>
      <div className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
        <span>{props.hostname}</span>
        <span className="grow" />
        <Button
          disabled={props.restarting || asking}
          onClick={() => setAsking(true)}
          size="xs"
          variant="outline"
        >
          {props.restarting ? <Spinner size="xs" /> : <RotateCwIcon />}
          {props.restarting ? `Restarting ${props.hostname}…` : `Restart ${props.hostname}`}
        </Button>
      </div>
      {asking ? (
        <div
          aria-label={`Restart ${props.hostname}`}
          className="flex flex-wrap items-center gap-2 text-xs text-foreground"
          role="alertdialog"
        >
          <span className="grow">{RESTART_CONFIRM(props.hostname)}</span>
          <Button
            onClick={() => {
              setAsking(false);
              props.onRestart();
            }}
            size="xs"
          >
            Restart
          </Button>
          <Button onClick={() => setAsking(false)} size="xs" variant="ghost-muted">
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
