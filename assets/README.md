# Brand icons

The three Icon Composer projects are the source of truth for full application icons:

- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

Each project uses `mark.svg` for the canonical Zerops mark from `packages/shared/src/brand.ts`
and `background.svg` when the channel-specific background is a vector layer. Additional layers use
semantic names that describe their role and placement.

Run `vp run icons:export` from the repository root to regenerate the tracked macOS, iOS, Linux,
Windows, and web assets. The development web exports are also copied to `apps/web/public` for the
browser favicon and splash screen. Run `vp run icons:check` to verify that every generated asset and
public copy matches its source without changing files.

Cross-platform exports require Icon Composer 2 or newer on macOS. The script selects the newest
compatible exporter from Xcode or a standalone Icon Composer installation and pins design
generation 26. Set `ICON_COMPOSER_TOOL` to the full path of
`Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS exports

The exporter uses Xcode's `actool` to compile each canonical `.icon` project for macOS and extract
its 1024px standalone rendition. This avoids the full-bleed result produced by a plain `ictool`
macOS image export. Run the macOS path independently on a machine without Icon Composer 2:

```sh
vp run icons:export:macos
vp run icons:check:macos
```

The result must be a 1024×1024 PNG with the classic macOS safe area: the opaque icon body is 824×824, inset 100 pixels on every side, with only the native Icon Composer shadow extending into the surrounding transparent canvas.

Do not edit the generated PNG or ICO files directly.

## Android adaptive foreground

`apps/mobile/assets/android-icon-foreground.svg` is the source of truth for the foreground used by
the normal Android adaptive launcher icon. Export its paired PNG after changing it:

```sh
rsvg-convert -w 432 -h 432 \
  -o apps/mobile/assets/android-icon-foreground.png \
  apps/mobile/assets/android-icon-foreground.svg
```

The foreground must remain transparent and keep the Zerops mark inside Android's adaptive-icon
safe zone. `android-icon-mark.png` remains a flat silhouette for Android's monochrome themed icon.

## Widget mark

`apps/mobile/assets/widget/T3Mark.svg` retains its compatibility filename because the generated
widget asset catalog refers to that name. Its artwork uses the canonical Zerops mark; the widget
catalog treats the SVG as a template and applies the contextual status tint at runtime.
