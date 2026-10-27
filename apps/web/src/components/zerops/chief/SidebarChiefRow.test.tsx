import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SidebarChiefRow, SidebarChiefTile } from "./SidebarChiefRow";

// The owner, 2026-10-15: "unread is not highlighted at all". The Chief is a Mate: a result of it
// not seen wears the unread dot on its mark, as a Mate's face on the rail does.
describe("the Chief's row", () => {
  it.each([
    { case: "its row", Row: SidebarChiefRow, unseen: true },
    { case: "its row, everything seen", Row: SidebarChiefRow, unseen: false },
    { case: "its tile on the rail", Row: SidebarChiefTile, unseen: true },
    { case: "its tile on the rail, everything seen", Row: SidebarChiefTile, unseen: false },
  ])("An unread Chief shows its dot: $case", ({ Row, unseen }) => {
    const html = renderToStaticMarkup(
      <Row current={false} face="done" onOpen={() => {}} unseen={unseen} />,
    );
    expect(html.includes('data-zerops-surface="sidebar-chief-unread"')).toBe(unseen);
  });
});
