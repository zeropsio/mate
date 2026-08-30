import { describe, expect, it } from "vite-plus/test";

import { readDefaultMobileThemeVariables } from "./mobileTheme.test-support";
import { getMobileThemeVariables } from "./mobileTheme";
import { getMobileThemeRuntimeVariables } from "./mobileThemeVariables";

describe("mobile theme runtime variables", () => {
  it("resolves the default through the generated Zerops variants", () => {
    const light = getMobileThemeRuntimeVariables("zerops", "light");
    const dark = getMobileThemeRuntimeVariables("zerops", "dark");

    expect(light).toEqual(getMobileThemeVariables("zerops", "light"));
    expect(light).toEqual(readDefaultMobileThemeVariables("light"));
    expect(dark).toEqual(getMobileThemeVariables("zerops", "dark"));
    expect(dark).toEqual(readDefaultMobileThemeVariables("dark"));
  });

  it("uses the same shared palette source as generated custom themes", () => {
    expect(getMobileThemeRuntimeVariables("ocean", "light")).toEqual(
      getMobileThemeVariables("ocean", "light"),
    );
    expect(getMobileThemeRuntimeVariables("iris", "dark")).toEqual(
      getMobileThemeVariables("iris", "dark"),
    );
  });
});
