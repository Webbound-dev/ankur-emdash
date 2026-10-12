# Form email audit

Reviewed 2026-10-10. All nine submission endpoints and the data sheet OTP sender
now use the admin-configured Generic SMTP transport. Recipient editing
is now available under **Plugins → Form email recipients** at
`/_emdash/admin/plugins/emdash-smtp/form-recipients`. Each of the nine fields
stores one validated address; saved settings override the corresponding
environment address on the next submission. Subjects/templates remain in the
endpoints. Industrial/RFQ attachments are decoded and forwarded to Nodemailer.
The native form path reads the same SMTP settings but bypasses the standard
EmDash email hook (which does not carry attachments); form deliveries are not
currently recorded in the plugin's SMTP Logs screen.

All nine submission endpoints call `src/lib/sendFormSubmissionEmail.ts`.
That helper resolves the recipient and calls `src/lib/sendSiteEmail.ts`, which
reads SMTP credentials and sender identity from EmDash plugin settings. No
ZeptoMail API token is required by the form or OTP senders anymore.

Each endpoint owns its subject, HTML template and recipient environment variable.
Templates are inline server-side HTML, not templates stored in ZeptoMail or CMS
content. User text is HTML-escaped and multiline messages retain line breaks.

## Recipients and templates

Addresses below come from `wrangler.jsonc`. No recipient overrides were found in
the local `.env`; remote Worker settings were not queried. Each recipient can
still be changed independently via its environment variable.

| Form / endpoint | Recipient setting | Configured address | Subject | Template contents |
| --- | --- | --- | --- | --- |
| General contact / `submit-contact-general` | `CONTACT_GENERAL_EMAIL` | `info@ankurgroup.in` | New contact form message: subject | Name, email, city, state, subject, message |
| Industrial contact / `submit-contact-industrial` | `CONTACT_INDUSTRIAL_EMAIL` | `info@ankurgroup.in` | New contact form bulk/industrial inquiry: company | Company, industry, grade, quantity, delivery location, email, optional message/attachment name |
| Industrial salt RFQ / `submit-bulk-enquiry` | `BULK_ENQUIRY_EMAIL` | `info@ankurgroup.in` | New bulk enquiry (RFQ): company | Company, industry, grade, quantity, delivery location, email, optional message/attachment name |
| Become a distributor / `submit-distributor-application` | `BECOME_DISTRIBUTOR_EMAIL` | `info@ankurgroup.in` | New distributor application: business | Business, contact person, phone, email, city, state, optional message |
| Connect with a distributor / `submit-connect-distributor` | `CONNECT_DISTRIBUTOR_EMAIL` | `info@ankurgroup.in` | New "Connect with a Distributor" enquiry: name | Name, phone, email, city, state, optional message |
| Export enquiry / `submit-export-inquiry` | `EXPORT_INQUIRY_EMAIL` | `export@ankurgroup.in` | New export inquiry: company | Company, contact person, country, phone, email, optional message |
| Footer newsletter / `submit-newsletter` | `NEWSLETTER_SIGNUP_EMAIL` | `info@ankurgroup.in` | New newsletter signup | Subscriber email |
| Data sheet request / `submit-datasheet-request` | `DATASHEET_REQUEST_EMAIL` | `info@ankurgroup.in` | Technical data sheet download: company | Name, company, verified email from signed OTP token |
| Career application / `submit-career-application` | `CAREER_APPLICATION_EMAIL` | `info@ankurgroup.in` | New career application: name | Name, email, phone, team, message |

The general/industrial forms are in `ContactUs.astro`; RFQ and data sheet flows
are in `IndustrialSalt.astro`; distributor/export forms are separate React
components; the newsletter is in `Footer.tsx`; careers are in `Careers.astro`.

## Special behavior to preserve

- Industrial contact and RFQ use multipart requests and support one attachment
  up to 10 MiB. Files are currently base64-encoded for ZeptoMail, with filename
  and MIME type. Other endpoints submit JSON and do not send attachments.
- The career form currently has no CV attachment delivery.
- The newsletter form sends an internal notification; it does not add the
  address to a mailing-list service or send a subscriber confirmation.
- Submission notifications go to the business inbox, not the visitor. The
  visitor's address is printed in the body; no per-submission Reply-To is set.
- Eight submission routes verify reCAPTCHA when its secret is configured. The
  data sheet route instead checks the signed OTP token/code on the server and
  derives the visitor's email from the verified token.
- `/api/send-otp` now calls the same native SMTP sender. It sends the visitor
  "Your Ankur Salt verification code", with a 10-minute expiry. It must also
  retain its signing/expiry behavior. The downloaded PDF is
  opened by the browser after submission succeeds; it is not emailed.
- Routes await delivery before returning success. Provider rejection produces
  an error response, usually HTTP 502. Preserve that behavior rather than
  treating failed delivery as a successful submission.

## SMTP migration approach

Preserve route-specific templates, recipient variables, validation and frontend
payloads. Replace the shared sender's transport with server-side access to the
configured Generic SMTP provider and sender settings. Migrate OTP delivery
through the same sender without changing signing or expiry behavior.

The standard EmDash email message contract includes recipient, CC, Reply-To,
subject, text and HTML, but no attachment property. This was verified in the
installed EmDash 1.2.0 types and the live
[email hook reference](https://docs.emdashcms.com/reference/hooks/).
The installed SMTP core also normalizes messages without attachments, and the
current local SMTP adapter does not forward them. A plain replacement with
`ctx.email.send()` would therefore not preserve both existing file-upload forms.

Use an attachment-aware native delivery path sharing the admin-managed Generic
SMTP settings and SMTP transport. Add MIME attachment handling to that transport,
including base64 decoding and filename/content-type preservation. Keep sender
credentials server-side, retain delivery logs for each form, and prevent fallback
to console delivery or an unrelated provider. If HTTP fallback is retained,
attachment handling must be supported there too rather than silently dropping
files.

Regression checks in `migration/check-forms.mjs` now exercise all nine real
handlers against a mocked SMTP sender (63 checks), including recipient edits,
HTML escaping, attachment bytes, validation, missing configuration and delivery
failure. `migration/check-otp-smtp.mjs` verifies the OTP template, recipient and
signed token flow. Adapter checks verify attachment forwarding and runtime load.
Real inbox and attachment delivery still need an end-to-end test.

## References in this repository

- `src/lib/sendFormSubmissionEmail.ts`: current shared delivery helper
- `src/pages/api/submit-*.ts`: independent subjects/templates/recipients
- `src/pages/api/send-otp.ts`: separate OTP sender
- `src/lib/env.ts` and `wrangler.jsonc`: recipient and sender configuration
- `src/plugins/smtp-cloudflare.mjs`: provider admin and delivery hook
- `src/plugins/smtp-transport.mjs`: current SMTP-only transport
- `migration/check-forms.mjs`: existing form regression coverage
