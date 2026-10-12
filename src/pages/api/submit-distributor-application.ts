import type { APIRoute } from 'astro';
import { corsHeaders, escapeHtml, sendFormSubmissionEmail } from '../../lib/sendFormSubmissionEmail';
import { verifyRecaptcha } from '../../lib/recaptcha';
import { getEnv } from '../../lib/env';

// See the comment on `adapter` in astro.config.mjs — any non-prerendered
// route needs the Node adapter configured regardless of what it does.
export const prerender = false;

// ankur-admin renders this same form (for content-editing preview) from a
// different origin, so this is reflected rather than locked to one origin.
export const OPTIONS: APIRoute = ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};

interface ApplicationBody {
  businessName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  message?: string;
  recaptchaToken?: string;
}

const REQUIRED_FIELDS = ['businessName', 'contactName', 'phone', 'email', 'city', 'state'] as const;

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const env = getEnv(locals);

  let body: ApplicationBody;
  try {
    body = (await request.json()) as ApplicationBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  const recaptcha = await verifyRecaptcha(body.recaptchaToken, 'distributor_application', env.RECAPTCHA_SECRET_KEY);
  if (!recaptcha.ok) {
    return new Response(JSON.stringify({ error: recaptcha.error }), { status: 400, headers });
  }

  for (const field of REQUIRED_FIELDS) {
    if (!body[field]?.trim()) {
      return new Response(JSON.stringify({ error: `Missing required field: ${field}` }), { status: 400, headers });
    }
  }

  const { businessName, contactName, phone, email, city, state, message } = body as Required<Omit<ApplicationBody, 'message'>> &
    Pick<ApplicationBody, 'message'>;

  const result = await sendFormSubmissionEmail({
    to: env.BECOME_DISTRIBUTOR_EMAIL,
    recipientKey: 'BECOME_DISTRIBUTOR_EMAIL',
    subject: `New distributor application: ${businessName}`,
    htmlBody: `
      <p><strong>Business / Firm Name:</strong> ${escapeHtml(businessName)}</p>
      <p><strong>Contact Person:</strong> ${escapeHtml(contactName)}</p>
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
