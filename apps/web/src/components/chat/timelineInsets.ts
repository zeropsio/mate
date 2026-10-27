/**
 * What the composer covers of each conversation's list, as the pane last
 * measured it (`ChatView`). The banners over the composer are the
 * conversation's own and are measured only a draw after it opens, so a list
 * shown in the press frame — kept from before, or warmed — stands with the
 * inset remembered for it, never the conversation left's. In memory for the
 * tab's life, forgotten when the account closes.
 */
import { onAccountLifetimeClose } from "../../zerops/accountLifetime";

const insets = new Map<string, number>();

onAccountLifetimeClose(() => insets.clear());

export function rememberTimelineInset(threadKey: string, inset: number): void {
  insets.set(threadKey, inset);
}

export function rememberedTimelineInset(threadKey: string): number | undefined {
  return insets.get(threadKey);
}
