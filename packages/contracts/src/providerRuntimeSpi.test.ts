import { describe, expect, it } from "vite-plus/test";

import type { ProviderRuntimeEvent } from "./providerRuntime.ts";
import { PROVIDER_RUNTIME_SPI_VERSION, type SpiEvent } from "./providerRuntimeSpi.ts";

describe("providerRuntimeSpi", () => {
  it("declares the current SPI version", () => {
    expect(PROVIDER_RUNTIME_SPI_VERSION).toBe("2.1");
  });

  it("SpiEvent is ProviderRuntimeEvent — a value typed as one satisfies the other", () => {
    // Compile-time assertion: if `SpiEvent` ever diverges from
    // `ProviderRuntimeEvent`, this file fails to typecheck.
    const assertAssignable = (event: ProviderRuntimeEvent): SpiEvent => event;
    const assertReverseAssignable = (event: SpiEvent): ProviderRuntimeEvent => event;
    expect(typeof assertAssignable).toBe("function");
    expect(typeof assertReverseAssignable).toBe("function");
  });
});
