/** Raster formats kept in private change descriptions; SVG and document types are excluded. */
export const RASTER_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;
export type RasterContentType = (typeof RASTER_CONTENT_TYPES)[number];
