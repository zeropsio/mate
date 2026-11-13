import { createFileRoute } from "@tanstack/react-router";

import { ChatLinkPage } from "../components/zerops/ChatLinkPage";

// The code is out of the address before the router exists (`main.tsx`, `chatLinkCode.ts`).
export const Route = createFileRoute("/chat-link")({ component: ChatLinkPage });
