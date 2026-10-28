import type { APIRoute } from 'astro';
import { corsHeaders, escapeHtml, sendFormSubmissionEmail } from '../../lib/sendFormSubmissionEmail';
import { verifyRecaptcha } from '../../lib/recaptcha';
import { getEnv } from '../../lib/env';
import { isOtherOption } from '../../lib/ui-strings';

export const prerender = false;

// ankur-admin renders this same form (for content-editing preview) from a
// different origin, so this is reflected rather than locked to one origin.
export const OPTIONS: APIRoute = ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};

// Matches the "up to 10MB" copy already shown under the attachment field.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };
  const env = getEnv(locals);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  const recaptcha = await verifyRecaptcha(form.get('recaptchaToken'), 'bulk_enquiry', env.RECAPTCHA_SECRET_KEY);
  if (!recaptcha.ok) {
    return new Response(JSON.stringify({ error: recaptcha.error }), { status: 400, headers });
  }

  const company = field(form, 'company');
  const industry = field(form, 'industry');
  const industryOther = field(form, 'industryOther');
  const grade = field(form, 'grade');
  const gradeOther = field(form, 'gradeOther');
  const quantity = field(form, 'quantity');
  const location = field(form, 'location');
  const email = field(form, 'email');
  const message = field(form, 'message');

  const resolvedIndustry = isOtherOption(industry) ? industryOther : industry;
  const resolvedGrade = isOtherOption(grade) ? gradeOther : grade;

  if (!company || !resolvedIndustry || !resolvedGrade || !quantity || !location || !email) {
    return new Response(JSON.stringify({ error: 'Please fill in all required fields' }), { status: 400, headers });
  }

  const attachments: { name: string; content: string; mime_type: string }[] = [];
  const file = form.get('attachment');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return new Response(JSON.stringify({ error: 'Attachment must be under 10MB' }), { status: 400, headers });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    attachments.push({
      name: file.name,
      content: buffer.toString('base64'),
      mime_type: file.type || 'application/octet-stream',
    });
  }

  const result = await sendFormSubmissionEmail({
    to: env.BULK_ENQUIRY_EMAIL,
    recipientKey: 'BULK_ENQUIRY_EMAIL',
    subject: `New bulk enquiry (RFQ): ${company}`,
    htmlBody: `
      <p><strong>Company Name:</strong> ${escapeHtml(company)}</p>
      <p><strong>Industry:</strong> ${escapeHtml(resolvedIndustry)}</p>
      <p><strong>Grade Required:</strong> ${escapeHtml(resolvedGrade)}</p>
      <p><strong>Quantity:</strong> ${escapeHtml(quantity)}</p>
      <p><strong>Delivery Location:</strong> ${escapeHtml(location)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${message ? `<p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : ''}
      ${attachments.length ? `<p><strong>Attachment:</strong> ${escapeHtml(attachments[0].name)}</p>` : ''}
    `,
    attachments,
    env,
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: 502, headers });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
