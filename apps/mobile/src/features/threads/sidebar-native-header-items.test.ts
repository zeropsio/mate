import { describe, expect, it, vi } from "vite-plus/test";

import { createSidebarHeaderItems } from "./sidebar-native-header-items";

describe("createSidebarHeaderItems", () => {
  it("labels the thread filter without promising sort controls", () => {
    const [filterItem] = createSidebarHeaderItems({
      filterIcon: "line.3.horizontal.decrease.circle",
      filterMenu: { title: "Thread list options", items: [] },
      onOpenSettings: vi.fn(),
    });

    expect(filterItem).toMatchObject({ accessibilityLabel: "Filter threads" });
  });
});
