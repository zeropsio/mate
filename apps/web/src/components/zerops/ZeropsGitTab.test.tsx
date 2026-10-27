import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import { ZeropsGitTab, type ZeropsGitTabProps } from "./ZeropsGitTab";
const source = vi.hoisted(() => ({ error: undefined as string | undefined, again: vi.fn() }));
vi.mock("../../zerops/useProjectTopology", () => ({
  useProjectTopology: () => ({ view: undefined, error: source.error, again: source.again }),
}));
const props: ZeropsGitTabProps = {
  threadRef: null,
  appId: undefined,
  declarations: [],
  changes: undefined,
  mateProjectId: undefined,
  isOwner: false,
};
it.each([undefined, "Zerops refused the services list."])(
  "an unread or refused topology never says there are no repositories (%s)",
  (error) => {
    source.error = error;
    const markup = renderToStaticMarkup(<ZeropsGitTab {...props} />);
    expect(markup).toContain(error ?? "Reading repositories.");
    expect(markup).toContain("Read again");
    expect(markup).not.toContain("No repositories");
  },
);
