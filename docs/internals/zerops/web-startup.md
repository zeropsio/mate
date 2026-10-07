# Hosted web startup composition

The web defers route components, conversation side panels, review bodies, the theme editor,
snooze calendar and the terminal renderer until their surface is demanded. Dialog and panel
frames retain their place and show a loading state while the module arrives. The global hosts,
operation lifetimes and account store remain mounted. Desktop uses these same web boundaries;
mobile retains its existing source path.

Build and inspect the released web configuration:

```sh
T3CODE_WEB_ANALYZE=1 VITE_HOSTED_APP_CHANNEL=latest VITE_HOSTED_APP_URL=https://mate.zerops.io pnpm --filter @t3tools/web build
node scripts/web-startup.ts apps/web/dist
```

The Vite manifest records static and dynamic chunk dependencies. `bundle-composition.json` also
records every chunk's imports and module lengths before chunk minification; it is emitted only
for an analysis build. The inspection sums each unique JS file in a surface's static dependency
closure, including the initial index route for menu-to-conversation navigation. It excludes CSS,
source maps and modules demanded by rich content such as highlighted code fences. Gzip uses level 9
per file. These are production asset budgets, not measured network timings.

Measured on 2026-10-07, starting from Mate 0.14.38 (decimal MB; decoded / gzip):

| Step                                          | Sign-in       | Plain conversation |
| --------------------------------------------- | ------------- | ------------------ |
| Baseline                                      | 7.146 / 2.233 | 7.146 / 2.233      |
| Route components                              | 5.208 / 1.697 | 6.602 / 2.148      |
| Global hosts and shared export separation     | 4.186 / 1.390 | 6.425 / 2.114      |
| Panel entries and remaining export separation | 3.879 / 1.302 | 5.849 / 1.940      |
| Static startup chunk grouping                 | 3.757 / 1.181 | 5.736 / 1.824      |

A matched control build of `origin/main` at `41270589e6` measured 7.168 / 2.240 MB.
The integrated change measured sign-in 3.882 / 1.219 MB, menu/projects 4.029 / 1.273 MB
and plain conversation 5.858 / 1.861 MB. This control keeps unrelated main changes out
of the attributed saving.

The final sign-in needs two JS chunks. Rolldown's `$initial` tag groups the actual static startup
modules together; it does not pull dynamic surfaces into a generic vendor chunk.

The largest deferrable baseline costs, ranked by library/module length before minification, were:

1. Route-only pages and their dependencies: settings, usage, project/environment details and
   reviews. Route splitting removed about 1.94 MB decoded from sign-in.
2. Markdown/raw HTML and the prompt editor: parse5 alone was 195 KB; Lexical and its React bindings
   were 216 KB. A composer loading placeholder imported the full editor for a typography constant,
   and release/keyboard helpers imported full detail/review surfaces. Those shared exports now
   have small modules. Markdown and Lexical remain eager when a conversation actually opens.
3. Snooze date picking: react-day-picker was 99 KB and date-fns 50 KB; neither is required before
   opening the calendar.
4. Theme search/import: JSZip was 135 KB, already removed from startup by route splitting.
   The theme editor now loads when Settings, the palette or its shortcut opens it.
5. Terminal: the 50 KB Ghostty surface module and its WASM URL move behind viewport demand;
   terminal WASM was already fetched only by renderer creation. Side-panel bodies load on selection.
6. Icon sets and shared UI: lucide was 87 KB, Pierre's tree helpers 50 KB, and JetBrains icons
   54 KB. The shared icon/UI modules still used by navigation remain in startup. React, Effect,
   the account store and contract decoding remain startup dependencies. There was no separate
   chart or broad locale-library cost requiring another boundary; the manifest shows no duplicate
   versions of the large dependencies above. HEIC conversion, diff rendering and syntax
   highlighting already had demand boundaries.

The production demand scenarios assert that sign-in, menu and ordinary chat request none of the
unopened surface chunks, then open Helpers and the theme shortcut and verify their modules load.
A separate journey opens Usage while Appearance remains deferred. Existing change/release and
chat journeys cover the visible behavior across navigation and dialog entry points.
