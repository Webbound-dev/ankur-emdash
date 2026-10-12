import type { APIRoute } from 'astro';
import { corsHeaders, escapeHtml, sendFormSubmissionEmail } from '../../lib/sendFormSubmissionEmail';
import { getEnv } from '../../lib/env';
import { verifyOtpToken } from '../../lib/otp';

export const prerender = false;

// ankur-admin renders this same form (for content-editing preview) from a
// different origin, so this is reflected rather than locked to one origin.
export const OPTIONS: APIRoute = ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};

interface RequestBody {
  name?: string;
  company?: string;
  token?: string;
  code?: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const env = getEnv(locals);

  const secret = env.OTP_SIGNING_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Email verification is not configured yet' }), { status: 500, headers });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  const { name, company, token, code } = body;
  if (!name?.trim() || !company?.trim() || !token || !code) {
    return new Response(JSON.stringify({ error: 'Missing required field' }), { status: 400, headers });
  }

  // Re-verifies the OTP server-side instead of trusting the client's
  // "verified" state — the token+code pair is the only real proof of email
  // ownership, same reasoning as verify-otp.ts itself. The email in the
  // notification below comes from the token's payload (not a client-supplied
  // field), so a verified address can't be swapped out after the fact.
  const otpResult = verifyOtpToken(token, code, secret);
  if (!otpResult.ok) {
    return new Response(JSON.stringify({ error: otpResult.error }), { status: 400, headers });
  }

  const result = await sendFormSubmissionEmail({
    to: env.DATASHEET_REQUEST_EMAIL,
    recipientKey: 'DATASHEET_REQUEST_EMAIL',
    subject: `Technical data sheet download: ${company}`,
    htmlBody: `
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Company:</strong> ${escapeHtml(company)}</p>
      <p><strong>Email:</strong> ${escapeHtml(otpResult.email)}</p>
    `,
    env,
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: 502, headers });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
