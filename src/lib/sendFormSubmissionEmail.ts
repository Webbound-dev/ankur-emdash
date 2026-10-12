// Shared by every api/submit-*.ts route — each site form (BecomeDistributorForm,
// ConnectWithDistributorForm, ExportInquiryForm, the industrial-salt Bulk
// Enquiry Form) emails its submission via the configured Generic SMTP provider. `to` is
// resolved from the admin's Form email recipients settings. Each route's
// environment address remains the fallback until an admin setting is saved.
import type { Env } from './env';
import { getFormRecipient, type FormRecipientKey } from './getFormRecipient';
import { sendSiteEmail } from './sendSiteEmail';

export async function sendFormSubmissionEmail({
  to,
  recipientKey,
  subject,
  htmlBody,
  attachments,
}: {
  to: string | undefined;
  recipientKey: FormRecipientKey;
  subject: string;
  htmlBody: string;
  attachments?: { name: string; content: string; mime_type: string }[];
  env: Env;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let recipient: string;
  try { recipient = await getFormRecipient(recipientKey, to); }
  catch { return { ok: false, error: 'Form recipient email is not configured correctly' }; }
  return sendSiteEmail({ to: recipient, subject, htmlBody, attachments });
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
