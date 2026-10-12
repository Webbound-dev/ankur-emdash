import { getPluginSetting } from 'emdash';
import { smtpSend } from '../plugins/smtp-transport.mjs';

export type SiteEmailAttachment = { name: string; content: string; mime_type: string };

// Form mail uses the same admin-managed SMTP credentials as the CMS transport.
// This native path also carries attachments, which EmDash's email hook omits.
export async function sendSiteEmail({ to, subject, htmlBody, attachments }: {
  to: string; subject: string; htmlBody: string; attachments?: SiteEmailAttachment[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const global = await getPluginSetting<Record<string, unknown>>('emdash-smtp', 'global');
    if (global?.primaryProviderId !== 'generic' || typeof global.fromEmail !== 'string' || !global.fromEmail.trim()) {
      return { ok: false, error: 'Choose Generic SMTP and configure its sender in SMTP Providers' };
    }
    const provider = await getPluginSetting<Record<string, unknown>>('emdash-smtp', 'provider:generic');
    if (!provider || typeof provider.host !== 'string' || !provider.host.trim()) {
      return { ok: false, error: 'Generic SMTP is not configured yet' };
    }
    const security = provider.security ?? 'starttls';
    if (!['ssl', 'starttls'].includes(security as string)) {
      return { ok: false, error: 'Configure SSL/TLS or STARTTLS in SMTP Providers' };
    }
    await smtpSend({
      host: provider.host.trim(), port: Number(provider.port ?? 587), secure: security === 'ssl',
      username: typeof provider.username === 'string' ? provider.username : undefined,
      password: typeof provider.password === 'string' ? provider.password : undefined,
    }, {
      to: [to], subject, html: htmlBody,
      fromEmail: global.fromEmail.trim(), fromName: typeof global.fromName === 'string' ? global.fromName : undefined,
      replyTo: typeof global.replyTo === 'string' && global.replyTo.trim() ? [global.replyTo.trim()] : undefined,
      attachments: attachments?.map((file) => ({ filename: file.name,
        content: Buffer.from(file.content, 'base64'), contentType: file.mime_type })),
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Unable to send email. Please try again.' };
  }
}
