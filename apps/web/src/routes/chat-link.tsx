import { createFileRoute } from "@tanstack/react-router";

import { ChatLinkPage } from "../components/zerops/ChatLinkPage";
import { keepChatLinkCode } from "../zerops/chatLinkCode";

export const Route = createFileRoute("/chat-link")({
  // Before anything renders, signed in or not: a sign-in returns to `/chat-link` but drops `#<code>`.
  beforeLoad: () => keepChatLinkCode(),
  component: ChatLinkPage,
});
