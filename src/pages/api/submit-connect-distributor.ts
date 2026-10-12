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

interface EnquiryBody {
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  message?: string;
  recaptchaToken?: string;
}

const REQUIRED_FIELDS = ['name', 'phone', 'email', 'city', 'state'] as const;

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const env = getEnv(locals);

  let body: EnquiryBody;
  try {
    body = (await request.json()) as EnquiryBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  const recaptcha = await verifyRecaptcha(body.recaptchaToken, 'connect_distributor', env.RECAPTCHA_SECRET_KEY);
  if (!recaptcha.ok) {
    return new Response(JSON.stringify({ error: recaptcha.error }), { status: 400, headers });
  }

  for (const field of REQUIRED_FIELDS) {
    if (!body[field]?.trim()) {
      return new Response(JSON.stringify({ error: `Missing required field: ${field}` }), { status: 400, headers });
    }
  }

  const { name, phone, email, city, state, message } = body as Required<Omit<EnquiryBody, 'message'>> & Pick<EnquiryBody, 'message'>;

  const result = await sendFormSubmissionEmail({
    to: env.CONNECT_DISTRIBUTOR_EMAIL,
    recipientKey: 'CONNECT_DISTRIBUTOR_EMAIL',
    subject: `New "Connect with a Distributor" enquiry: ${name}`,
    htmlBody: `
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Phone Number:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>City:</strong> ${escapeHtml(city)}</p>
      <p><strong>State:</strong> ${escapeHtml(state)}</p>
      ${message?.trim() ? `<p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : ''}
    `,
    env,
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: 502, headers });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
