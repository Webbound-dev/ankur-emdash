import type { APIRoute } from 'astro';
import { getEnv } from '../../lib/env';
import { verifyOtpToken } from '../../lib/otp';

export const prerender = false;

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

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  const secret = getEnv(locals).OTP_SIGNING_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Email verification is not configured yet' }), { status: 500, headers });
  }

  let token: string | undefined;
  let code: string | undefined;
  try {
    ({ token, code } = (await request.json()) as { token?: string; code?: string });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  if (!token || !code) {
    return new Response(JSON.stringify({ error: 'Missing token or code' }), { status: 400, headers });
  }

  const result = verifyOtpToken(token, code, secret);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: 400, headers });
  }

  return new Response(JSON.stringify({ ok: true, email: result.email }), { status: 200, headers });
};
