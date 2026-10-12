import type { APIRoute } from 'astro';
import { createHash, createHmac } from 'node:crypto';
import { getEnv } from '../../lib/env';
import { sendSiteEmail } from '../../lib/sendSiteEmail';

// This is one of two non-static routes in an otherwise fully prerendered
// site — see the comment on `adapter` in astro.config.mjs for why any
// non-prerendered route needs an adapter configured at all, regardless of
// what it does internally.
export const prerender = false;

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ankur-admin renders these same forms (for content-editing preview) from a
// different origin, so this is reflected rather than locked to one origin.
// No cookies/credentials are used, so that doesn't expose anything beyond
// what the request body itself already contains.
function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export const OPTIONS: APIRoute = ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};

// No KV/database is configured, so the code isn't stored server-side at all
// — instead this returns a signed, opaque token carrying a salted hash of
// the code plus its expiry. verify-otp.ts re-derives the hash from the code
// the visitor typed and compares. The raw code only ever exists in the sent
// email — never in a response body, so a client can't read it back out.
function sign(payloadB64: string, secret: string) {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  let email: string | undefined;
  try {
    ({ email } = (await request.json()) as { email?: string });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  if (!email || !EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: 'A valid email address is required' }), { status: 400, headers });
  }

  const env = getEnv(locals);
  const secret = env.OTP_SIGNING_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Email verification is not configured yet' }), { status: 500, headers });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + OTP_TTL_MS;
  const codeHash = createHash('sha256').update(`${code}.${secret}.${email}`).digest('base64url');
  const payloadB64 = Buffer.from(JSON.stringify({ email, codeHash, expiresAt })).toString('base64url');
  const token = `${payloadB64}.${sign(payloadB64, secret)}`;

  const result = await sendSiteEmail({
    to: email,
    subject: 'Your Ankur Salt verification code',
    htmlBody: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
  });
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: 502, headers });
  }

  return new Response(JSON.stringify({ token }), { status: 200, headers });
};
