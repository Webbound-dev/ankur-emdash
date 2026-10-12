import { useState } from 'react';

// ankur-client hosts api/send-otp.ts + api/verify-otp.ts itself (via the
// Node adapter — see astro.config.mjs), so within ankur-client this is a
// same-origin relative fetch and PUBLIC_OTP_API_BASE_URL stays unset.
// ankur-admin renders these same form components too (for content-editing
// preview) but can't host the routes itself — it runs on Cloudflare
// Workers, and while ZeptoMail's plain HTTP API would work fine there too,
// nothing else about that app's setup needs it — so its
// PUBLIC_OTP_API_BASE_URL just points at wherever ankur-client is running
// instead of duplicating the routes.
const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.PUBLIC_OTP_API_BASE_URL ?? '';

// Real email OTP, sent via ZeptoMail's HTTP API. No code ever touches this
// client: send-otp returns an opaque signed token (the code lives only in
// the token as a salted hash, and in the email itself), and verify-otp
// checks the user's input against that token.
export function useOtpVerification() {
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  async function sendOtp(email: string) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error || 'Failed to send verification code');
      setToken(data.token);
      setOtpSent(true);
      setOtpInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code');
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp() {
    if (!token) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, code: otpInput }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Incorrect code. Please try again.');
      setVerified(true);
      setOtpSent(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect code. Please try again.');
    } finally {
      setVerifying(false);
    }
  }

  // Call when the underlying email value changes — editing an
  // already-verified (or mid-verification) address shouldn't silently keep
  // trust in an address that's no longer what was verified.
  function reset() {
    setVerified(false);
    setOtpSent(false);
    setOtpInput('');
    setError(null);
    setToken(null);
  }

  return { otpSent, otpInput, setOtpInput, verified, error, sending, verifying, sendOtp, verifyOtp, reset };
}
