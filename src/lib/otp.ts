import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Constant-time comparison for both the token's signature and the code hash
// — a naive === leaks timing information a network attacker could use to
// guess either byte-by-byte.
function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export type OtpVerifyResult = { ok: true; email: string } | { ok: false; error: string };

// Shared by verify-otp.ts and any other route that needs to re-check a
// verified email server-side (e.g. submit-datasheet-request.ts) rather than
// trusting the client's "verified" state — the token+code pair is the only
// real proof of email ownership.
export function verifyOtpToken(token: string, code: string, secret: string): OtpVerifyResult {
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return { ok: false, error: 'Invalid token' };

  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (!safeEqual(sig, expectedSig)) return { ok: false, error: 'Invalid or tampered token' };

  let email: string;
  let codeHash: string;
  let expiresAt: number;
  try {
    ({ email, codeHash, expiresAt } = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')));
  } catch {
    return { ok: false, error: 'Invalid token' };
  }

  if (Date.now() > expiresAt) return { ok: false, error: 'Code has expired. Please request a new one.' };

  const candidateHash = createHash('sha256').update(`${code}.${secret}.${email}`).digest('base64url');
  if (!safeEqual(candidateHash, codeHash)) return { ok: false, error: 'Incorrect code. Please try again.' };

  return { ok: true, email };
}
