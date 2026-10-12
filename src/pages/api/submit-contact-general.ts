import type { APIRoute } from 'astro';
import { corsHeaders, escapeHtml, sendFormSubmissionEmail } from '../../lib/sendFormSubmissionEmail';
import { verifyRecaptcha } from '../../lib/recaptcha';
import { getEnv } from '../../lib/env';

export const prerender = false;

// ankur-admin renders this same form (for content-editing preview) from a
// different origin, so this is reflected rather than locked to one origin.
export const OPTIONS: APIRoute = ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};

interface GeneralBody {
  name?: string;
  email?: string;
  city?: string;
  state?: string;
  subject?: string;
  message?: string;
  recaptchaToken?: string;
}

const REQUIRED_FIELDS = ['name', 'email', 'city', 'state', 'subject', 'message'] as const;

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const env = getEnv(locals);

  let body: GeneralBody;
  try {
    body = (await request.json()) as GeneralBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  const recaptcha = await verifyRecaptcha(body.recaptchaToken, 'contact_general', env.RECAPTCHA_SECRET_KEY);
  if (!recaptcha.ok) {
    return new Response(JSON.stringify({ error: recaptcha.error }), { status: 400, headers });
  }

  for (const f of REQUIRED_FIELDS) {
    if (!body[f]?.trim()) {
      return new Response(JSON.stringify({ error: `Missing required field: ${f}` }), { status: 400, headers });
    }
  }

  const { name, email, city, state, subject, message } = body as Required<GeneralBody>;

  const result = await sendFormSubmissionEmail({
    to: env.CONTACT_GENERAL_EMAIL,
    recipientKey: 'CONTACT_GENERAL_EMAIL',
    subject: `New contact form message: ${subject}`,
    htmlBody: `
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>City:</strong> ${escapeHtml(city)}</p>
      <p><strong>State:</strong> ${escapeHtml(state)}</p>
      <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
      <p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    `,
    env,
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: 502, headers });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
