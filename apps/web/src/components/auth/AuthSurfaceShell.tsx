import type { ReactNode } from "react";

import { APP_DISPLAY_NAME } from "../../branding";

/**
 * Full-screen card for standalone auth pages, mirroring the pairing surface's
 * treatment. Used by the CLI-connect authorize and callback surfaces.
 */
export function AuthSurfaceShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(48rem_20rem_at_top,color-mix(in_srgb,var(--color-blue-500)_12%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_94%,var(--color-black))_0%,var(--background)_62%)]" />
      </div>

      <section className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-card/94 shadow-2xl shadow-black/20 backdrop-blur-md">
        <header className="relative h-24 overflow-hidden">
          <div className="relative h-full p-5 sm:p-6">
            <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.2em] uppercase">
              {APP_DISPLAY_NAME}
            </p>
          </div>
        </header>

        <div className="p-6 sm:p-8">{children}</div>
      </section>
    </div>
  );
}
