export interface Env {
  OTP_SIGNING_SECRET?: string;
  ZEPTOMAIL_API_TOKEN?: string;
  ZEPTOMAIL_FROM_EMAIL?: string;
  ZEPTOMAIL_API_URL?: string;
  ZEPTOMAIL_FROM_NAME?: string;
  RECAPTCHA_SECRET_KEY?: string;
  CONTACT_GENERAL_EMAIL?: string;
  CONTACT_INDUSTRIAL_EMAIL?: string;
  CONNECT_DISTRIBUTOR_EMAIL?: string;
  BULK_ENQUIRY_EMAIL?: string;
  BECOME_DISTRIBUTOR_EMAIL?: string;
  EXPORT_INQUIRY_EMAIL?: string;
  DATASHEET_REQUEST_EMAIL?: string;
  NEWSLETTER_SIGNUP_EMAIL?: string;
  CAREER_APPLICATION_EMAIL?: string;
}

// Cloudflare Worker bindings (the secrets/vars configured on the Worker, plus
// wrangler.jsonc `vars`) are read from the `cloudflare:workers` module. The
// old `Astro.locals.runtime.env` was removed in @astrojs/cloudflare v13+.
// `import.meta.env` still supplies `.env` values in local dev. The `locals`
// parameter is kept so every api/submit-*.ts call site stays unchanged.
import { env as workerEnv } from 'cloudflare:workers';

export function getEnv(_locals?: App.Locals): Env {
  return { ...import.meta.env, ...workerEnv } as Env;
}
