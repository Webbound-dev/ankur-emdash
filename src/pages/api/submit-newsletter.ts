import type { APIRoute } from 'astro';
import { corsHeaders, escapeHtml, sendFormSubmissionEmail } from '../../lib/sendFormSubmissionEmail';
import { verifyRecaptcha } from '../../lib/recaptcha';
import { getEnv } from '../../lib/env';

export const prerender = false;

// ankur-admin renders this same footer (for content-editing preview) from a
// different origin, so this is reflected rather than locked to one origin.
export const OPTIONS: APIRoute = ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};

interface NewsletterBody {
  email?: string;
  recaptchaToken?: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const env = getEnv(locals);

  let body: NewsletterBody;
  try {
    body = (await request.json()) as NewsletterBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  const recaptcha = await verifyRecaptcha(body.recaptchaToken, 'newsletter_signup', env.RECAPTCHA_SECRET_KEY);
  if (!recaptcha.ok) {
    return new Response(JSON.stringify({ error: recaptcha.error }), { status: 400, headers });
  }

  const email = body.email?.trim();
  if (!email) {
    return new Response(JSON.stringify({ error: 'Missing required field: email' }), { status: 400, headers });
  }

  const result = await sendFormSubmissionEmail({
    to: env.NEWSLETTER_SIGNUP_EMAIL,
    recipientKey: 'NEWSLETTER_SIGNUP_EMAIL',
    subject: 'New newsletter signup',
    htmlBody: `<p><strong>Email:</strong> ${escapeHtml(email)}</p>`,
    env,
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: 502, headers });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
