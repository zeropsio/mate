import {
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";

import type ChatViewComponent from "./ChatView";
import { SurfaceLoading } from "./SurfaceLoading";

type ChatViewProps = ComponentProps<typeof ChatViewComponent>;

// Both routes load the one module: a visible draft has already loaded its conversation.
let loaded: ComponentType<ChatViewProps> | null = null;
let loading: Promise<ComponentType<ChatViewProps>> | null = null;
const loadChatView = () =>
  (loading ??= import("./ChatView").then((module) => (loaded = module.default)));

/**
 * Starts fetching the conversation's code now (a reload on a conversation's address, at boot), so
 * it arrives with the conversation's data rather than after it. The one shared load: a failure is
 * met by the boundary, which shows the route's error view.
 */
export function preloadChatView(): void {
  loadChatView().catch(() => undefined);
}

/**
 * The conversation's lazy code inside the inset. Only its chunk is waited on here — `waiting`
 * stands meanwhile, the thread route's own stage, so one stage hands over to the conversation —
 * and no Suspense boundary sits around the conversation: what it waits on itself still reaches
 * the route's own stages, as before the chunk moved inside the inset.
 */
export default function ChatViewBoundary({
  waiting,
  ...props
}: ChatViewProps & { readonly waiting?: ReactNode }) {
  const [view, setView] = useState<{ readonly ChatView: ComponentType<ChatViewProps> } | null>(
    () => (loaded === null ? null : { ChatView: loaded }),
  );
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    if (view !== null) return;
    let live = true;
    loadChatView().then(
      (ChatView) => {
        if (live) setView({ ChatView });
      },
      (error: unknown) => {
        // A chunk a deploy removed reaches the route's error view, which reloads to the new build.
        loading = null;
        if (live) setFailure(error ?? new Error("The conversation's code did not load."));
      },
    );
    return () => {
      live = false;
    };
  }, [view]);
  if (failure !== null) throw failure;
  if (view === null) return waiting ?? <SurfaceLoading />;
  return <view.ChatView {...props} />;
}
