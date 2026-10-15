// Above-the-fold hero images under /images/ have a pre-generated
// "-mobile.webp" sibling in public/images (a resized copy carried over from
// ankur-client — no build step creates them, so a new hero image there needs
// its sibling added the same way). Images picked from the media library, and
// files that are already the mobile copy, have none: undefined means "use the
// original everywhere".
export function mobileVariant(src: string | undefined): string | undefined {
  if (!src || !/^\/images\/.+\.(jpe?g|png|webp)$/i.test(src) || /-mobile\.webp$/i.test(src)) return undefined;
  return src.replace(/\.(jpe?g|png|webp)$/i, '-mobile.webp');
}
