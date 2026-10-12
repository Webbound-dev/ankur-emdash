# EmDash SMTP installation

EmDash SMTP 0.4.0 is installed with Bun and registered in `astro.config.mjs`.
Provider credentials and sender configuration are admin-managed. All nine form
submission routes and the data sheet OTP route now read these Generic SMTP
settings through `src/lib/sendSiteEmail.ts`, preserving recipient editing,
templates and attachments.

The npm plugin is documented by [EmDash](https://docs.emdashcms.com/guides/email/)
and its [publisher](https://github.com/masonjames/emdash-smtp). From the project
directory, installation uses Bun:

```bash
bun add emdash-smtp
```

The project registers the upstream descriptor with a local native entrypoint,
`src/plugins/smtp-cloudflare.mjs`. It uses the installed `emdash-smtp-core`
delivery engine, provider settings, admin pages and logging. Generic SMTP uses
`src/plugins/smtp-transport.mjs`, importing only Nodemailer's SMTP transport and
mailer. The upstream entrypoint also imports local sendmail, whose
`node:child_process` dependency failed the Cloudflare module-load check. The
SMTP-only adapter passes that check with the existing `nodejs_compat` flag.
It requires no Worker Loader binding or paid sandbox. Recheck the adapter when
upgrading SMTP or Nodemailer: it uses SMTP core 0.4.0 and Nodemailer 6.10.1 APIs.

The admin adapter repairs unavailable saved editor selections, preserves
credentials and delivery routes, and excludes local sendmail from the picker.
Generic SMTP is available and accepts encrypted submission on ports 465 and 587.
Provider saves merge unchanged stored fields and materialize SMTP defaults, so
changed-fields-only admin submissions do not lose the port or encryption.
Delivery and test sends require a configured primary route, avoiding upstream's
automatic selection of local sendmail when an active provider is incomplete.
STARTTLS is required on non-implicit-TLS connections; plaintext delivery is not
advertised. SMTP connections have bounded timeouts and close on success/failure.

Restart the server. Under **Plugins → SMTP Providers**, select **Generic SMTP**.
For ZeptoMail, copy the hostname and password from the account's **SMTP/API →
SMTP** tab (use the account's regional hostname). Set port **465**, encryption
**SSL/TLS**, username **emailapikey**, and the SMTP password. Add the verified
sender email and sender name, save settings, and choose **Use Generic SMTP for
delivery**. Select SMTP in EmDash email settings and use Test delivery to confirm.
ZeptoMail also supports port 587 with STARTTLS. See
[Zoho's SMTP instructions](https://www.zoho.com/cpaas/help/smtp-home.html).
Never put credentials in committed project files.

```bash
node migration/check-smtp.mjs
```

Mocked checks verify HTTP delivery/logs, SMTP connection options, TLS requirements,
sender/reply-to handling, failure cleanup, provider filtering, Generic SMTP editor
and stale selection recovery. Cloudflare workerd loads the adapter successfully.
Real TCP/TLS authentication and inbox delivery require configured credentials and
a delivery test; no real email was sent.
The local settings were corrected to Generic SMTP as the primary route, port
465 and SSL/TLS after a failed test exposed missing persisted defaults. The
database was backed up before this correction; saved credentials were preserved.
The production build was attempted but blocked by Astro's font HTTP server
opening a port forbidden by this session (`listen EPERM`).

The custom form/OTP native path shares the configured Generic SMTP settings but
bypasses EmDash's standard email hook to preserve attachment support. These
deliveries do not appear in SMTP Logs yet. Mocked form/OTP tests pass; a real
inbox and attachment delivery test remains necessary.

The registry alternative needs a Cloudflare sandbox runner, `LOADER` Worker
Loader binding, `PluginBridge` export and Workers Paid plan. Those prerequisites
have not been enabled in this project. See [EmDash's installation guide](https://docs.emdashcms.com/plugins/installing/).
