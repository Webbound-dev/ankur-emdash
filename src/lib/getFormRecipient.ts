import { getPluginSetting } from 'emdash';
import { FORM_RECIPIENTS_KEY, isRecipientEmail } from './formRecipientSettings.mjs';
import type { Env } from './env';

export type FormRecipientKey = Extract<keyof Env,
  'CONTACT_GENERAL_EMAIL' | 'CONTACT_INDUSTRIAL_EMAIL' | 'BULK_ENQUIRY_EMAIL' |
  'BECOME_DISTRIBUTOR_EMAIL' | 'CONNECT_DISTRIBUTOR_EMAIL' | 'EXPORT_INQUIRY_EMAIL' |
  'DATASHEET_REQUEST_EMAIL' | 'NEWSLETTER_SIGNUP_EMAIL' | 'CAREER_APPLICATION_EMAIL'>;

export async function getFormRecipient(key: FormRecipientKey, fallback: string | undefined) {
  const recipients = await getPluginSetting<Record<string, unknown>>('emdash-smtp', FORM_RECIPIENTS_KEY);
  const value = recipients?.[key] ?? fallback;
  if (!isRecipientEmail(value)) throw new Error('Form recipient email is not configured correctly');
  return (value as string).trim();
}
