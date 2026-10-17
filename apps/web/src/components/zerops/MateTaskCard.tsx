/**
 * A task's first message in an automated Mate's conversation, drawn as the issue it brings: the
 * issue's title, where it lives and who opened it, and a way out to it on GitHub. The words the
 * agent got with it are its brief, never the person's, so they are never drawn.
 */
import type { MateTaskSource } from "@t3tools/contracts";
import { ArrowUpRightIcon } from "lucide-react";

import { InlineButton } from "../ui/button";

/** "acme/tea-shop#12 · opened by nova-dev": where the issue lives, and whose it is. */
export function mateTaskCardSource(task: MateTaskSource): string {
  const where = `${task.repo}#${String(task.number)}`;
  return task.author === null ? where : `${where} · opened by ${task.author}`;
}

export function MateTaskCard({ task }: { readonly task: MateTaskSource }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-2xl border border-border/70 bg-card px-4 py-2.5"
      data-zerops-surface="mate-task-card"
    >
      <p className="min-w-0 truncate text-prose font-medium text-foreground">{task.title}</p>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-line text-muted-foreground">
        <span className="min-w-0 truncate">{mateTaskCardSource(task)}</span>
        <InlineButton render={<a href={task.url} rel="noreferrer" target="_blank" />}>
          Open on GitHub
          <ArrowUpRightIcon aria-hidden="true" className="ms-0.5 inline size-3" />
        </InlineButton>
      </p>
    </div>
  );
}
