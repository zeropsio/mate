import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";

import chatLink from "../../design/chat-link.flow.tsx";
import { stateElement } from "../../design/mount.tsx";

// witness: apps/web/src/components/zerops/ChatLinkPage.tsx | actions={hasCode ? <Button onClick={onRetry}>Try again</Button> : null} → actions={!hasCode ? <Button onClick={onRetry}>Try again</Button> : null}
it("MN159: A refused chat link that still holds its code offers another attempt, and a link HQ may have taken offers none; breaks: a person retries a code HQ already spent, or cannot retry a refusal.", () => {
  expect(renderToStaticMarkup(stateElement(chatLink, "refused"))).toContain("<button");
  expect(renderToStaticMarkup(stateElement(chatLink, "uncertain"))).not.toContain("<button");
});
