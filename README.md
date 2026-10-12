# Ankur Salt: EmDash site

One repo, one Worker. Astro 7 + [EmDash](https://docs.emdashcms.com) on Cloudflare (D1 + R2).
The public site is the existing Ankur UI, unchanged. Content is edited in the stock
EmDash admin at `/_emdash/admin`.

This replaces the former four-repo setup (`ankur-client`, `ankur-admin`,
`ankur-data`, `ankur-ui-components`).

## Layout

```
astro.config.mjs        astro + react + tailwind + emdash(d1, r2); output: server
wrangler.jsonc          D1 (DB), R2 (MEDIA), cron, form-routing vars
seed/seed.json          content model (114 block types, 7 collections) + all content
src/
  worker.ts             EmDash Worker entry (scheduled publishing)
  live.config.ts        EmDash loader (boilerplate)
  ui/components/        the Ankur UI components (was ankur-ui-components)
  ui/lib/               their helpers (reCAPTCHA, OTP hook, map maths)
  lib/content/          reads EmDash and rebuilds the original JSON shapes
    codec.mjs           lossless encode/decode (shared with migration scripts)
    index.ts            getPage / getProducts / getBlogs / getDistributors
  content/specs.json    generated: how each original field maps to EmDash
  layouts/BaseLayout.astro
  pages/                public routes + api/* (forms, OTP)
public/                 images, videos, audio, certificate PDFs, robots.txt
migration/              one-time tooling (see below); delete after cutover
```

## How content works

Pages and collections keep their original JSON shape in the components. EmDash stores
each page as an entry in one of four collections (`pages`, `business_pages`,
`legal_pages`, `site_chrome`); every section of a page is a **block** (e.g.
`home_hero`, `about_timeline`). `products`, `blogs` and `distributors` are normal
collections; product detail sections are `blocks` fields. Blog articles use one
native `portableText` rich text editor, with headings, lists, formatting, links,
images, and tables inside the document.

`src/lib/content` converts that storage back into the exact objects the components
received from `ankur-data`, so no component or page markup had to change.

Blog articles are rendered with EmDash's `PortableText` component. The content
adapter also reads the former blog composition format during rollout.

Section order on a page is fixed by the page template (as before). Editing the
content of a section, not reordering sections, is what the admin is for.

Images use native image pickers throughout the CMS, including repeated gallery,
logo and product items. PDFs, downloadable certificates and video assets use
native file pickers. Existing assets remain at their original public URLs;
new uploads are resolved through EmDash's media endpoint. The adapter preserves
the public components' existing image and download props.

EmDash repeaters support image fields but do not support file fields. Hero
slides, factory videos and repeated certificates therefore have individual
item blocks alongside their section's heading block. Their order in the
section controls their order within that list; the page's section layout
remains fixed. YouTube embeds keep their URL fields.

## Commands

```bash
pnpm dev                          # http://localhost:4321, admin at /_emdash/admin
# first run only: load the seed (schema + all content) and sign in as a dev admin
open http://localhost:4321/_emdash/api/setup/dev-bypass

pnpm build && pnpm wrangler deploy
```

## Migration tooling (`migration/`)

| File | Purpose |
|---|---|
| `source/` | The original `ankur-data` JSON (input) |
| `generate.mjs` | Builds `seed/seed.json` + `src/content/specs.json` from `source/` |
| `roundtrip.mjs` | Proves `decode(encode(x)) === x` for every page/entry and that every block satisfies the schema |
| `compare-html.py` | Diffs rendered HTML against a baseline build of the old site |
| `old-pages/` | The original page files, kept for reference |

```bash
node migration/generate.mjs && node migration/roundtrip.mjs
```

For an existing SQLite database, changing the seed does not change its schema.
Migrate the blog article field and all saved revisions explicitly (Node 22.16+
with `node:sqlite` backup support):

```bash
node migration/blog-rich-text.mjs --database /path/to/database.sqlite
node migration/blog-rich-text.mjs --database /path/to/database.sqlite --apply
```

The first command is a dry run. Applying creates a complete SQLite backup, then
converts entries, revisions, and the field definition in one transaction. It
preserves publication state and pending drafts. Restart `pnpm dev` afterwards
to refresh generated types. This script targets a local SQLite file, not remote
D1; a deployed database needs a separate migration before its admin uses the
rich editor. Do not replace a populated deployed database with the seed.

Existing local databases also need the media field migration:

```bash
node migration/media-fields.mjs --database /path/to/database.sqlite
node migration/media-fields.mjs --database /path/to/database.sqlite --apply
node migration/check-media-fields.mjs
```

Applying backs up the entire database and migrates field definitions, page
blocks, collection entries, and saved revisions in one transaction. Breaking
block changes create new versions and retain the old contracts. Restart the
dev server afterwards. Like the blog migration, this targets a local SQLite
file; deployment to an existing remote D1 database requires a separate migration.
The media check validates the seed and its values against EmDash's actual
schemas and verifies that newly selected uploads render as working asset URLs.

To migrate the existing files from `public/` into the local media library, run
this after the media field migration:

```bash
node migration/import-assets.mjs --database /path/to/database.sqlite
node migration/import-assets.mjs --database /path/to/database.sqlite --apply
node migration/check-imported-assets.mjs --database /path/to/database.sqlite --before /path/to/database.sqlite.assets-backup-TIMESTAMP.sqlite --manifest .wrangler/media-import/manifest.json
```

The importer uses Cloudflare's installed local R2 runtime, checks every stored
file against its original bytes, and backs up D1 before updating library records,
content, and saved revisions. Its persisted manifest makes interrupted runs safe
to retry. Defaults match this project's `ankur-media` bucket and Wrangler state;
use `--persistence`, `--bucket`, and `--manifest` when targeting another local
environment. EmDash's database triggers queue media usage indexing.

The local import migrated 72 source files into 69 unique library assets and
updated 236 references across 28 entries and 28 revisions. Five referenced
leadership photos (`public/images/about/leader-1.jpg` through `leader-5.jpg`)
are absent and remain external references. Original public files are retained
for static page references and rollback. Restart the dev server to refresh the
library. This command imports locally; it does not upload to production R2 or
modify remote D1.

### Distributor states and Network cleanup

The `distributors` collection is now labelled **Distributor states** and has a
single authored field, **State**, stored as the CMS title. The content adapter
still exposes `{ id, state }` to the two maps. The seed has one entry per state
(31 entries); dummy distributor names, contacts and the display-order control
are removed. Network's unused search labels and directory section are removed
from its current editor; its hero, SEO, forms and tabs are retained.

Existing local databases need this migration after the earlier schema changes:

```bash
node migration/distributor-states.mjs --database /path/to/database.sqlite
node migration/distributor-states.mjs --database /path/to/database.sqlite --apply
node migration/check-distributor-states.mjs --database /path/to/database.sqlite --before /path/to/database.sqlite.distributor-states-backup-TIMESTAMP.sqlite
```

Applying creates a full database backup, removes the obsolete distributor
columns and fields, and cleans the affected saved revisions. Duplicate published
states are moved to trash (8 in the current local database). Revision IDs and
publication pointers remain intact. Network hero changes use a new block
version, and historical block contracts remain immutable. Restart the dev
server to refresh schema caches. Production D1 has not been migrated.

### Remaining unused fields

The current schemas omit unused quote and leadership images, map numeric values,
Industrial Salt grade columns and unused specifications, its disabled client
logo section, and its unused resend label. Separate image-alt text controls are
consolidated into the image picker's alt field; rendered alt text is preserved.
Map fallback state names, hardness badges, intentionally parked navigation and
all media-library assets are retained.

For an existing local database, save its current `src/content/specs.json` before
generating the new schema, then run:

```bash
node migration/unused-fields.mjs --database /path/to/database.sqlite
node migration/unused-fields.mjs --database /path/to/database.sqlite --apply
node migration/check-unused-fields.mjs --database /path/to/database.sqlite --before /path/to/database.sqlite.unused-fields-backup-TIMESTAMP.sqlite --before-specs /path/to/original-specs.json
```

Applying makes a full database backup and updates schema, entries and revisions
in one transaction. Historical block contracts and publication pointers are
preserved. The local migration passed comparisons of all 73 stored documents
and 73 revisions, including trashed duplicate states. Restart the dev server
to refresh schema caches. Production has not been migrated.

### Navigation menus

Header and footer navigation now live in **Menus**. `navbar_left` and
`navbar_right` preserve the two sides of the centered logo;
`navbar_products` supplies the existing product menu. The two `navbar_*_parked`
menus retain hidden links and are not rendered. Move a parked item into an
active menu to display it. `footer_navigation` uses top-level items as column
headings (URL `#`), with each column's links as children; `footer_legal` holds
the legal links. Edit labels, URLs and order in Menus.

The **Branding & footer copy** content type retains logos, newsletter copy,
contact details, the contact CTA and copyright text. Its navigation blocks
are removed from the current editor, while historical block contracts remain.
The site's server-side adapter queries native menus and registers menu cache
hints without changing the header/footer layout.

For an existing local database, preserve its original specs before generating
the new schema, then run this after the unused-field migration:

```bash
node migration/navigation-menus.mjs --database /path/to/database.sqlite --before-specs /path/to/original-specs.json
node migration/navigation-menus.mjs --database /path/to/database.sqlite --before-specs /path/to/original-specs.json --apply
node migration/check-navigation-menus.mjs --database /path/to/database.sqlite --before /path/to/database.sqlite.navigation-backup-TIMESTAMP.sqlite --before-specs /path/to/original-specs.json
```

The migration copies current database values, makes a full backup and applies
the change atomically. It refuses to overwrite existing menus or discard
different saved navigation edits. All 7 menus / 39 items and all 73 revisions
passed preservation checks locally. Restart the dev server afterward.
Production has not been migrated.

## Form email delivery

EmDash SMTP is installed with Bun and registered for CMS email delivery.
Its Cloudflare adapter supports Generic SMTP and HTTP providers, settings UI
and logs without loading local sendmail. Configure sender
and credentials under **Plugins → SMTP Providers**, then select SMTP in email
settings. See [SMTP setup](reports/smtp-setup.md) for runtime checks and limits.

Edit the nine submission inboxes under **Plugins → Form email recipients**.
Saved addresses take effect on new submissions immediately. Until saved,
the form routes use their existing recipient environment variables. Templates,
uploads and email transport remain independent of recipient editing.
This does not replace the custom site's existing ZeptoMail form/OTP calls.

All nine site forms have email API routes, including careers. They send
notifications through ZeptoMail; success means the provider accepted the
request, rather than confirmed delivery to the recipient's inbox.

Recipients are configured in `wrangler.jsonc`: export inquiries go to
`export@ankurgroup.in`; the remaining forms go to `info@ankurgroup.in`.
`CAREER_APPLICATION_EMAIL` can be changed independently.

Production needs `ZEPTOMAIL_API_TOKEN` and `OTP_SIGNING_SECRET` as Worker
secrets. The sender and regional API URL are already in `wrangler.jsonc`.
For local delivery, put the secrets in the ignored `.dev.vars` file.
If enabling reCAPTCHA, configure both `RECAPTCHA_SECRET_KEY` as a Worker secret
and `PUBLIC_RECAPTCHA_SITE_KEY` at build time.

```bash
pnpm exec wrangler secret put ZEPTOMAIL_API_TOKEN
pnpm exec wrangler secret put OTP_SIGNING_SECRET
node migration/check-forms.mjs
```

The form check runs the actual API handlers with a mocked provider: it verifies
recipients, attachments, rejected requests, missing configuration, and provider
failures without sending email. To confirm live delivery, an authorized test
submission must be checked in ZeptoMail and the recipient's inbox. Missing email
credentials fail the submission; the UI must not display a success message.

## Notes

- `compressHTML` is off on purpose: Astro 5 and 7 minify whitespace differently and Astro 7's
  output can change spacing between inline elements. Uncompressed markup renders like the old site.
- Form routes (`src/pages/api/*`) read secrets via `cloudflare:workers` (`src/lib/env.ts`).
  Set `ZEPTOMAIL_API_TOKEN`, `OTP_SIGNING_SECRET`, `RECAPTCHA_SECRET_KEY` as Worker secrets.
