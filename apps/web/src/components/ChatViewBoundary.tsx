import { lazy, Suspense, type ComponentProps } from "react";
import { SurfaceLoading } from "./SurfaceLoading";

// Both routes use the same lazy instance: a visible draft has already loaded its conversation.
const ChatView = lazy(() => import("./ChatView"));

export default function ChatViewBoundary(props: ComponentProps<typeof ChatView>) {
  return (
    <Suspense fallback={<SurfaceLoading />}>
      <ChatView {...props} />
    </Suspense>
  );
}
