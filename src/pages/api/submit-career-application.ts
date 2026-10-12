import type { APIRoute } from 'astro';
import { corsHeaders, escapeHtml, sendFormSubmissionEmail } from '../../lib/sendFormSubmissionEmail';
import { verifyRecaptcha } from '../../lib/recaptcha';
import { getEnv } from '../../lib/env';

export const prerender = false;
export const OPTIONS: APIRoute = ({ request }) => new Response(null, {
  status: 204, headers: corsHeaders(request.headers.get('origin')),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(request.headers.get('origin')) };
  const respond = (status: number, data: object) => new Response(JSON.stringify(data), { status, headers });
  const env = getEnv(locals);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(400, { error: 'Invalid request body' });
  } catch {
    return respond(400, { error: 'Invalid request body' });
  }
  const field = (key: string) => typeof body[key] === 'string' ? body[key].trim() : '';
  const name = field('name');
  const email = field('email');
  const phone = field('phone');
  const team = field('team');
  const message = field('message');
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(400, { error: 'Please enter your name, a valid email address, and a message' });
  }
  try {
    const recaptcha = await verifyRecaptcha(body.recaptchaToken, 'career_application', env.RECAPTCHA_SECRET_KEY);
    if (!recaptcha.ok) return respond(400, { error: recaptcha.error });
    const result = await sendFormSubmissionEmail({
      to: env.CAREER_APPLICATION_EMAIL,
    recipientKey: 'CAREER_APPLICATION_EMAIL',
      subject: `New career application: ${name}`,
      htmlBody: `<p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
        <p><strong>Team:</strong> ${escapeHtml(team)}</p>
        <p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
      env,
    });
    return result.ok ? respond(200, { ok: true }) : respond(502, { error: result.error });
  } catch {
    return respond(502, { error: 'Unable to submit your application. Please try again.' });
  }
};
