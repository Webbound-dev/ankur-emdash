// Verifies a reCAPTCHA v3 token server-side, shared by every api/submit-*.ts
// route. Score threshold matches Google's own docs default (0.5).
const SCORE_THRESHOLD = 0.5;

export async function verifyRecaptcha(
  token: unknown,
  expectedAction: string,
  secretKey: string | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Not configured yet (see ankur-client/.env) — skip rather than block
  // every form submission until real keys are added.
  if (!secretKey) return { ok: true };

  if (typeof token !== 'string' || !token) {
    return { ok: false, error: 'reCAPTCHA verification failed' };
  }

  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: secretKey, response: token }),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; score?: number; action?: string };

  if (!data.success || data.action !== expectedAction || (data.score ?? 0) < SCORE_THRESHOLD) {
    return { ok: false, error: 'reCAPTCHA verification failed' };
  }
  return { ok: true };
}
