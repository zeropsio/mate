import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { StatusPage } from "~/components/ui/status-page";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";
import { StateFrame } from "../states/StateFrame";

export default definePlayground({
  section: "status-page",
  name: "StatusPage",
  imports: 'import { StatusPage } from "~/components/ui/status-page";',
  controls: {
    title: { kind: "text" },
    body: { kind: "text" },
    mark: { kind: "boolean" },
    actions: { kind: "boolean" },
    footer: { kind: "boolean" },
  },
  initial: {
    title: "Opening your project…",
    body: "Keep this tab open while the project loads.",
    mark: true,
    actions: false,
    footer: false,
  },
  render: ({ title, body, mark, actions, footer }) => (
    <StateFrame size="page">
      <StatusPage
        actions={actions ? <Button>Try again</Button> : undefined}
        footer={footer ? <Button variant="ghost-muted">Back to the project</Button> : undefined}
        mark={mark ? <Spinner size="md" /> : undefined}
        title={title}
      >
        {body === "" ? undefined : <p>{body}</p>}
      </StatusPage>
    </StateFrame>
  ),
  jsx: ({ title, body, mark, actions, footer }) =>
    jsxElement(
      "StatusPage",
      {
        title: jsxCode(JSON.stringify(title)),
        mark: mark ? jsxCode('<Spinner size="md" />') : undefined,
        actions: actions ? jsxCode("<Button>Try again</Button>") : undefined,
        footer: footer
          ? jsxCode('<Button variant="ghost-muted">Back to the project</Button>')
          : undefined,
      },
      body === "" ? undefined : `<p>{${JSON.stringify(body)}}</p>`,
    ),
});
