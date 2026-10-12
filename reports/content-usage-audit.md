# CMS content usage audit

Update: the distributor and Network findings below have now been addressed
locally. Distributor states has one editable State field and 31 active records;
8 duplicate state records were moved to trash. Dummy contact columns and
Network's unused search/directory controls were removed, including from saved
revision data. The remaining confirmed unused fields have also been removed
locally: quote/leadership images, map numeric values, unused Industrial Salt
grade fields and labels, and its disabled client-logo section. Duplicate alt
controls are consolidated into native image fields with alt text preserved.
Intentionally parked navigation, map fallback names and used hardness badges
are retained. All 73 stored documents and 73 revisions passed preservation
checks; media-library records and historical block contracts remain intact.
The inventory below records the original audit snapshot, not the current
cleaned schema. Production has not been migrated.

Audited 10 October 2026 against the current local CMS database and the current
site source. Coverage: 17 page/chrome documents, 6 products, 11 blogs and 39
distributors (73 documents across 7 collections), including their routes,
components, metadata, structured data, sorting and conditional UI.

This is a source and local-data audit, not a production browser verification.
No CMS data, schema or site behavior was changed during this audit. A field
mentioned in an interface, comment or `data-cms-field` attribute was not treated
as proof that its value is used. Saved block versions and revisions were not
classified as disposable content.

[Full field/value inventory](content-usage-audit.csv) contains 307 flagged current
values: 261 not used publicly, 7 in a disabled section, 12 in an unreachable
submenu, 7 intentionally hidden, 5 fallback-only, 12 used indirectly, 2 settings
unused by the frontend and 1 overridden label. These categories have different
cleanup implications. The inventory excludes duplicate legacy alt fields,
which have a separate [18-definition inventory](content-audit-shadowed-alt-fields.json).

## Confirmed unused or disabled content

| Location | CMS content | Finding | Current extent | Evidence |
| --- | --- | --- | --- | --- |
| Distributor records | `name`, `region`, `city`, `address`, `phone` | Both maps consume only `state`. There are no public distributor cards, telephone links or directory results. `name` maps to the CMS `title`, so it still identifies the record in admin. | 5 fields × 39 records = 195 values unused publicly | [Network map](../src/ui/components/DistributorNetwork.tsx:146), [home map](../src/ui/components/DistributionMap.tsx:148), [codec specs](../src/content/specs.json) |
| Network page | `hero.searchPlaceholder`, `hero.searchButtonLabel` | No search input or button exists in the rendered component. | 2 values | [Network component](../src/ui/components/DistributorNetwork.tsx:160) |
| Network page | Entire `directory`: `eyebrow`, `heading`, `allLabel`, `resultLabel`, `emptyState` | Directory configuration is declared but no directory is rendered. | 5 values | [Network component](../src/ui/components/DistributorNetwork.tsx:60), [route](../src/pages/network.astro:11) |
| Home quote | `quote.image.src`, `quote.image.alt` | `image` is destructured but never used in markup or behavior. | 1 image, 2 values | [Quote component](../src/ui/components/QuoteSection.tsx:45) |
| Home distribution map | `distributionMap.states[].value` | Numbers 60, 180, 95, 70 and 50 do not appear anywhere and do not affect pin size, counts or placement. | 5 values | [Map state selection](../src/ui/components/DistributionMap.tsx:148) |
| About leadership | `leadership.people[].photo.src`, `.alt` | All 12 leadership cards show initials. They never render the configured photos. Five photo files are missing; seven entries use an avatar placeholder. Names, job titles and biographies are used. | 12 images, 24 values | [Leadership cards](../src/ui/components/AboutUs.astro:366) |
| Industrial Salt | Entire `trustedBy`: heading and three client names/logos | Rendering is explicitly disabled with `SHOW_TRUSTED_BY = false`. | 7 values | [Feature flag](../src/ui/components/IndustrialSalt.astro:44), [conditional section](../src/ui/components/IndustrialSalt.astro:77) |
| Industrial Salt grades | Entire `grades.columns`: `grade`, `nacl`, `hardness`, `moisture` | The old table headings are retained in CMS, but the current cards render no specification columns. | 4 labels | [Grade cards](../src/ui/components/GradesTable.tsx:155) |
| Industrial Salt grades | `grades.items[].nacl`, `.moisture` | Values are retained in each grade record but are not rendered or used in calculations. Downloading the uploaded PDF does not read or regenerate these values. Editing them does not change the PDF. | 2 fields × 12 grades = 24 values | [Grade cards](../src/ui/components/GradesTable.tsx:155), [PDF reference](../src/ui/components/IndustrialSalt.astro:363) |
| Industrial Salt download form | `dataSheets.gate.resendLabel` | The script uses hardcoded `const dsResendLabel = 'Resend'`. Editing the CMS label has no effect. | 1 value | [Runtime label](../src/ui/components/IndustrialSalt.astro:706) |
| Navbar product submenu | `products[].title`, `.href` | Both desktop and mobile branches test `link.href === '/products'`, but the actual CMS link is `/products/`. The six submenu items therefore never render with current content. The parent link itself remains usable. | 6 items, 12 values | [Desktop condition](../src/ui/components/NavbarIsland.tsx:106), [mobile condition](../src/ui/components/NavbarIsland.tsx:274) |
| Site settings | `settings.title`, `settings.tagline` | The site frontend does not call the EmDash settings API. Branding comes from navbar/footer documents and hardcoded metadata instead. These settings may still be used by EmDash internally. | 2 values | [Site layout](../src/layouts/BaseLayout.astro:11), [seed settings](../seed/seed.json:9) |

## Partially used, overridden or intentionally hidden content

| Location | CMS content | What is actually used | Cleanup implication |
| --- | --- | --- | --- |
| Home map | `distributionMap.states[].name` | A fallback only when the distributor list is absent or empty. With the current 39 records, coverage comes from their 31 distinct states instead. No editorial state legend is rendered. | Keep if fallback coverage is wanted; otherwise replace it with an explicit coverage model. |
| Industrial Salt grades | `grades.items[].hardness` | Numeric ppm values choose which grade receives the “Highest Purity” badge. The numeric text itself is not displayed. `tier` and `name` also drive the visible cards. | Do not remove hardness as an unused field without replacing badge selection. |
| Navbar | `leftLinksHidden`, `rightLinksHidden`, `_hiddenLinks_note` | Home, Blog and Career are intentionally excluded from the navbar. The note explicitly explains how to restore them. | These are deliberately parked navigation entries. The corresponding pages still work, and other links can reach them. |
| Media across the site | Separate legacy `alt`, `image_alt`, `photo_alt`, `logo_alt`, `hero_image_alt` fields | The adapter uses the native image picker's per-use `alt` whenever it is a string, overriding the separate legacy field, including when picker alt is empty. | There are 18 such field definitions, often repeated across rows. Editing the separate field may have no visible effect. Consolidate into picker alt while preserving old block versions and revisions. |

The alt override was verified without saving changes: changing a local blog
record's decoded-input `image_alt` did not change its rendered `imageAlt`, because
the native image's alt took precedence. See [adapter](../src/lib/content/codec.mjs:165).

## Used content with duplicated sources or placeholder behavior

These are used by the site, but their editing model can be misleading:

- **Home product teasers:** four independently authored teaser records, rather
  than references to the six product collection records. Product names, tags,
  images, descriptions and links can drift between home and product pages.
  Their links are used in the image modal, so they are not unused fields.
- **Home blog teasers:** five independently authored cards, rather than values
  read from the 11 blog records. Editing an article does not update its home
  teaser title, date, image, excerpt or link automatically.
- **Distributor and export forms:** Contact has separate copies of the form
  content also authored on Network and Export. Both copies render through shared
  components, but their headings, labels, placeholders and success copy can
  differ because they are separate CMS values.
- **Company information:** About and Champalal Group independently author their
  company lists and shared company descriptions. Both lists are used.
- **Gallery Instagram section:** six static product-image tiles render as the
  authored posts; the route does not load a live Instagram feed. These are used
  fallback content, not fetched social posts. See [route](../src/pages/gallery.astro:7).
- **Audio:** the second hardcoded track is explicitly a placeholder that reuses
  the first MP3. Both tracks are selectable, but they play identical audio.
  Audio filenames and track titles are outside the CMS. The home quote has two
  slides and its dots are driven by this hardcoded track list; adding more CMS
  quote slides alone would not add corresponding selectable tracks. See
  [audio tracks](../src/ui/components/AudioPlayer.tsx:9) and
  [quote dots](../src/ui/components/QuoteSection.tsx:315).
- **Archived Hindi content:** 15 page JSON files and 3 collection JSON files under
  `migration/source/*/hi` are migration inputs retained in the repo. Current
  loading uses only the English specs and collections; no Hindi public routes
  load them. They are archive files, not live CMS editing content.

The distributor contact details are dummy data as identified by the user.
The duplicate audio and avatar placeholders are explicit in the repository.
Other business facts, names, certificates, employment roles and marketing
claims have not been assumed to be dummy simply because they look generic.

## Content checked and retained

No additional unused authored body sections were confirmed in Career, Contact,
Export, Gallery, Champalal Group, Quality & Certificates, the legal pages, 404,
the product listing, product detail sections or the blog listing/detail pages.
The media alt duplication described above still applies where present.

SEO values and social images passed to `BaseLayout` are used even when they are
not visible in the page body. All five product comparison headings are used
through dynamic `columns[key]` access. All 17 export countries and 4 regions are
consumed by the map and the current authored statistics match those totals.
Certificate names can be used as tooltips, image alt text is accessibility
content, and success messages/download dialogs are used after interaction.

CMS record titles, slugs, IDs, collection positions and immutable block
metadata are administrative or operational data. Old block versions preserve
revision compatibility. These should not be removed as unused public copy.

## Suggested cleanup order

1. Resolve the Network content model: retain state coverage and admin titles,
   and remove the dummy contact fields and dead directory/search configuration
   if a public distributor directory is no longer intended.
2. Remove the unused quote image, map counts, leadership photo controls and
   industrial table headings/NaCl/moisture controls from the current editing
   schema if their features will stay absent. Preserve prior versions/history.
3. Decide whether to retain the disabled client-logo section and parked navbar
   links; their absence is intentional in source.
4. Repair the navbar submenu path condition and connect the resend label to its
   CMS value, so those authored values can work as intended.
5. Consolidate alt editing and replace duplicate teaser/form/company content
   with references or shared documents where one update should apply everywhere.

This report identifies cleanup candidates; it does not delete records, fields,
files or revisions.
