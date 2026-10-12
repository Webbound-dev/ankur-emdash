// reCAPTCHA v3 (invisible — no checkbox/challenge UI). Each of
// ankur-client/ankur-admin's PUBLIC_RECAPTCHA_SITE_KEY supplies its own key
// at build time (same per-app env pattern as PUBLIC_OTP_API_BASE_URL).
const SITE_KEY = (import.meta as unknown as { env?: Record<string, string> }).env?.PUBLIC_RECAPTCHA_SITE_KEY ?? '';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

let scriptLoad: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise((resolve, reject) => {
    if (window.grecaptcha) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${SITE_KEY}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load reCAPTCHA'));
    document.head.appendChild(script);
  });
  return scriptLoad;
}

// Resolves to '' (rather than rejecting) when no site key is configured yet,
// so forms keep working in local dev before real keys are wired up — see
// the RECAPTCHA_SECRET_KEY comment in ankur-client/.env, which skips
// server-side verification the same way when unset.
export async function getRecaptchaToken(action: string): Promise<string> {
  if (!SITE_KEY) return '';
  await loadScript();
  return new Promise((resolve, reject) => {
    window.grecaptcha!.ready(() => {
      window.grecaptcha!.execute(SITE_KEY, { action }).then(resolve).catch(reject);
    });
  });
}
