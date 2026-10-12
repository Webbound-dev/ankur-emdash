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

interface InquiryBody {
  companyName?: string;
  contactName?: string;
  country?: string;
  phone?: string;
  email?: string;
  message?: string;
  recaptchaToken?: string;
}

const REQUIRED_FIELDS = ['companyName', 'contactName', 'country', 'phone', 'email'] as const;

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const env = getEnv(locals);

  let body: InquiryBody;
  try {
    body = (await request.json()) as InquiryBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  const recaptcha = await verifyRecaptcha(body.recaptchaToken, 'export_inquiry', env.RECAPTCHA_SECRET_KEY);
  if (!recaptcha.ok) {
    return new Response(JSON.stringify({ error: recaptcha.error }), { status: 400, headers });
  }

  for (const field of REQUIRED_FIELDS) {
    if (!body[field]?.trim()) {
      return new Response(JSON.stringify({ error: `Missing required field: ${field}` }), { status: 400, headers });
    }
  }

  const { companyName, contactName, country, phone, email, message } = body as Required<Omit<InquiryBody, 'message'>> &
    Pick<InquiryBody, 'message'>;

  const result = await sendFormSubmissionEmail({
    to: env.EXPORT_INQUIRY_EMAIL,
    recipientKey: 'EXPORT_INQUIRY_EMAIL',
    subject: `New export inquiry: ${companyName}`,
    htmlBody: `
      <p><strong>Company Name:</strong> ${escapeHtml(companyName)}</p>
      <p><strong>Contact Person:</strong> ${escapeHtml(contactName)}</p>
      <p><strong>Country:</strong> ${escapeHtml(country)}</p>
      <p><strong>Phone Number:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${message?.trim() ? `<p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : ''}
    `,
    env,
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: 502, headers });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
