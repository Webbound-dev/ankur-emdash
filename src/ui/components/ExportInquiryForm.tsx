import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BadgeCheck, Building2, Globe2, Mail, MessageSquare, Phone, ShipWheel, User } from 'lucide-react';
import { isEditModeActive, onEditModeChange } from '../lib/editMode';
import { useOtpVerification } from '../lib/useOtpVerification';
import { getRecaptchaToken } from '../lib/recaptcha';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export interface ExportInquiryContent {
  eyebrow: string;
  heading: string;
  intro: string;
  benefits: string[];
  fields: {
    companyName: string;
    contactName: string;
    country: string;
    phone: string;
    email: string;
    message: string;
  };
  placeholders: {
    companyName: string;
    contactName: string;
    country: string;
    phone: string;
    email: string;
    message: string;
  };
  submitLabel: string;
  successHeading: string;
  successMessage: string;
}

type FieldKey = keyof ExportInquiryContent['fields'];

// Same base as useOtpVerification — ankur-client hosts the API route itself
// (same-origin relative fetch), ankur-admin points this at wherever
// ankur-client is running since it can't host the route on Cloudflare Workers.
const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.PUBLIC_OTP_API_BASE_URL ?? '';

const EMPTY_FORM: Record<FieldKey, string> = {
  companyName: '',
  contactName: '',
  country: '',
  phone: '',
  email: '',
  message: '',
};

// Icons stay code-level (not CMS-editable) — only the benefit copy itself
// comes from content. Order must match content.benefits. Same convention as
// BecomeDistributorForm's BENEFIT_ICONS.
const BENEFIT_ICONS = [BadgeCheck, Globe2, ShipWheel];

// Same placeholder-overlay technique as BecomeDistributorForm — a native
// <input>/<textarea> placeholder is an attribute, not a text node, so the
// generic contenteditable system has nothing to hook into.
function PlaceholderOverlay({
  field,
  empty,
  text,
  editing,
  top,
}: {
  field: string;
  empty: boolean;
  text: string;
  editing: boolean;
  top?: 'center' | 'start';
}) {
  if (!empty) return null;
  return (
    <span
      data-cms-field={field}
      className={`absolute left-10 right-3 font-sans text-sm text-indian-red/30 ${
        top === 'start' ? 'top-3' : 'top-1/2 -translate-y-1/2'
      } ${editing ? 'pointer-events-auto cursor-text' : 'pointer-events-none'}`}
    >
      {text}
    </span>
  );
}

export default function ExportInquiryForm({
  content,
  skipEntranceAnimation,
  cmsPath = 'inquiry',
}: {
  content: ExportInquiryContent;
  // Where the page stores this content, for inline editing paths.
  cmsPath?: string;
  // Set when rendered inside a tab-switcher (e.g. ContactUs.astro's Export
  // panel) — that wrapper shows/hides this form via a tab click, not a
  // scroll, and toggling display:none leaves this section's own
  // scroll-triggered entrance below with a zero-size trigger it can never
  // correctly re-fire on reveal. The tab wrapper handles the reveal
  // animation itself instead. Same convention as BecomeDistributorForm/
  // ConnectWithDistributorForm.
  skipEntranceAnimation?: boolean;
}) {
  const { eyebrow, heading, intro, benefits, fields, placeholders, submitLabel, successHeading, successMessage } = content;
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const emailOtp = useOtpVerification();

  useEffect(() => {
    setEditing(isEditModeActive());
    return onEditModeChange(setEditing);
  }, []);

  // Same entrance-animation approach as BecomeDistributorForm: pre-anim-hidden
  // (global.css) hides these elements via plain CSS from the very first
  // paint so there's no gap between the finished section painting and GSAP
  // catching up. fromTo (not .from) gives each tween an explicit end value
  // instead of letting GSAP infer one by reading the current computed style
  // (opacity:0 from the pre-hide), which would otherwise produce a no-op.
  useLayoutEffect(() => {
    if (skipEntranceAnimation) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: sectionRef.current, start: 'top 80%', once: true },
        defaults: { ease: 'power3.out' },
      });
      tl.fromTo('.eif-eyebrow-text', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 })
        .fromTo('.eif-heading', { opacity: 0, y: 24, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8 }, '<0.15')
        .fromTo('.eif-intro', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, '<0.3')
        .fromTo(
          '.eif-benefit',
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.08 },
          '<0.1',
        )
        .fromTo(
          '.eif-form-panel',
          { opacity: 0, y: 28, scale: 0.98 },
          { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'power3.out' },
          '<0.15',
        );
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  function update(key: FieldKey, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // shadcn-style field: rectangular (not a pill), thin neutral-strength
  // border, plain white fill, and a soft focus ring instead of a fill-color
  // change — same signature as BecomeDistributorForm/ConnectWithDistributorForm.
  const fieldClass =
    'w-full rounded-lg border border-indian-red/18 bg-white pl-10 pr-3.5 py-2.5 font-sans text-sm text-indian-red outline-none transition-shadow focus:border-indian-red/45 focus:ring-4 focus:ring-indian-red/[0.08]';
  const iconClass = 'absolute left-3.5 top-1/2 -translate-y-1/2 text-indian-red/35 pointer-events-none';
  // Wider right padding to clear the Send OTP/Verified control that sits
  // inside the email input, same technique as the leading-icon padding above.
  const emailFieldClass = fieldClass.replace('pr-3.5', 'pr-24');

  return (
    <section
      ref={sectionRef}
      id="export-inquiry"
      className={`${skipEntranceAnimation ? '' : 'pre-anim-hidden'} relative overflow-hidden bg-silent-white border-t border-indian-red/10 py-16 lg:py-24 scroll-mt-24`}
    >
      {/* Faint line texture — same signature used on dark sections elsewhere on the site. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: 'repeating-linear-gradient(90deg, #A82121 0, #A82121 1px, transparent 1px, transparent 28px)' }}
        aria-hidden="true"
      />

      <div className="relative max-w-[1100px] mx-auto px-6 lg:px-10 grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16 items-start">
        <div className="lg:sticky lg:top-28">
          <div className="mb-4">
            <span data-cms-field={`${cmsPath}.eyebrow`} className="eif-eyebrow-text font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-indian-red/60">
              {eyebrow}
            </span>
          </div>
          <h2
            data-cms-field={`${cmsPath}.heading`}
            className="eif-heading font-display font-medium text-indian-red text-3xl lg:text-4xl leading-[1.1] [text-wrap:balance]"
          >
            {heading}
          </h2>
          <p data-cms-field={`${cmsPath}.intro`} className="eif-intro mt-4 font-sans text-indian-red/65 text-sm lg:text-base leading-relaxed max-w-[420px]">
            {intro}
          </p>

          <ul className="mt-9 space-y-4">
            {benefits.map((text, i) => {
              const Icon = BENEFIT_ICONS[i % BENEFIT_ICONS.length];
              return (
                <li key={i} className="eif-benefit flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indian-red/[0.08] text-indian-red">
                    <Icon size={16} />
                  </span>
                  <span data-cms-field={`${cmsPath}.benefits[${i}]`} className="font-sans text-sm text-indian-red/70 leading-relaxed pt-1.5">
                    {text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="eif-form-panel relative rounded-xl bg-white border border-indian-red/[0.09] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.18)] overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-indian-red/60 via-indian-red to-indian-red/60" aria-hidden="true" />

          <div className="p-6 lg:p-10">
            {submitted ? (
              <div className="py-10 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indian-red/[0.08] text-indian-red">
                  <BadgeCheck size={22} />
                </span>
                <p data-cms-field={`${cmsPath}.successHeading`} className="mt-4 font-display font-medium text-xl text-indian-red">
                  {successHeading}
                </p>
                <p data-cms-field={`${cmsPath}.successMessage`} className="mt-2 font-sans text-sm text-indian-red/65 max-w-[360px] mx-auto">
                  {successMessage}
                </p>
              </div>
            ) : (
              <form
                className="grid grid-cols-1 sm:grid-cols-2 gap-5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!emailOtp.verified || submitting) return;
                  setSubmitError(null);
                  setSubmitting(true);
                  try {
                    const recaptchaToken = await getRecaptchaToken('export_inquiry');
                    const res = await fetch(`${API_BASE}/api/submit-export-inquiry`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...form, recaptchaToken }),
                    });
                    const data = (await res.json()) as { ok?: boolean; error?: string };
                    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to submit');
                    setSubmitted(true);
                  } catch (err) {
                    setSubmitError(err instanceof Error ? err.message : 'Failed to submit');
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <span data-cms-field={`${cmsPath}.fields.companyName`} className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.companyName}
                  </span>
                  <div className="relative">
                    <Building2 size={16} className={iconClass} />
                    <PlaceholderOverlay field={`${cmsPath}.placeholders.companyName`} empty={!form.companyName} text={placeholders.companyName} editing={editing} />
                    <input required type="text" aria-label={fields.companyName} value={form.companyName} onChange={(e) => update('companyName', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span data-cms-field={`${cmsPath}.fields.contactName`} className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.contactName}
                  </span>
                  <div className="relative">
                    <User size={16} className={iconClass} />
                    <PlaceholderOverlay field={`${cmsPath}.placeholders.contactName`} empty={!form.contactName} text={placeholders.contactName} editing={editing} />
                    <input required type="text" aria-label={fields.contactName} value={form.contactName} onChange={(e) => update('contactName', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span data-cms-field={`${cmsPath}.fields.country`} className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.country}
                  </span>
                  <div className="relative">
                    <Globe2 size={16} className={iconClass} />
                    <PlaceholderOverlay field={`${cmsPath}.placeholders.country`} empty={!form.country} text={placeholders.country} editing={editing} />
                    <input required type="text" aria-label={fields.country} value={form.country} onChange={(e) => update('country', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span data-cms-field={`${cmsPath}.fields.phone`} className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.phone}
                  </span>
                  <div className="relative">
                    <Phone size={16} className={iconClass} />
                    <PlaceholderOverlay field={`${cmsPath}.placeholders.phone`} empty={!form.phone} text={placeholders.phone} editing={editing} />
                    <input required type="tel" aria-label={fields.phone} value={form.phone} onChange={(e) => update('phone', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:col-span-2">
                  <span data-cms-field={`${cmsPath}.fields.email`} className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.email}
                  </span>
                  <div className="relative">
                    <Mail size={16} className={iconClass} />
                    <PlaceholderOverlay field={`${cmsPath}.placeholders.email`} empty={!form.email} text={placeholders.email} editing={editing} />
                    <input
                      required
                      type="email"
                      aria-label={fields.email}
                      value={form.email}
                      readOnly={emailOtp.verified}
                      onChange={(e) => {
                        update('email', e.target.value);
                        if (emailOtp.verified || emailOtp.otpSent) emailOtp.reset();
                      }}
                      className={emailFieldClass}
                    />
                    {emailOtp.verified ? (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 font-sans text-xs font-semibold text-emerald-700">
                        <BadgeCheck size={14} /> Verified
                      </span>
                    ) : (
                      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && (
                        <button
                          type="button"
                          disabled={emailOtp.sending}
                          onClick={() => emailOtp.sendOtp(form.email)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-indian-red/[0.08] px-2.5 py-1 font-sans text-xs font-semibold text-indian-red hover:bg-indian-red/[0.14] transition-colors disabled:opacity-50"
                        >
                          {emailOtp.sending ? 'Sending…' : emailOtp.otpSent ? 'Resend' : 'Send OTP'}
                        </button>
                      )
                    )}
                  </div>

                  {emailOtp.otpSent && !emailOtp.verified && (
                    <div className="mt-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="6-digit code"
                          value={emailOtp.otpInput}
                          onChange={(e) => emailOtp.setOtpInput(e.target.value.replace(/\D/g, ''))}
                          className="w-28 rounded-lg border border-indian-red/18 bg-white px-3 py-1.5 font-sans text-sm text-indian-red outline-none focus:border-indian-red/45 focus:ring-4 focus:ring-indian-red/[0.08]"
                        />
                        <button
                          type="button"
                          disabled={emailOtp.verifying}
                          onClick={emailOtp.verifyOtp}
                          className="rounded-md bg-indian-red px-3 py-1.5 font-sans text-xs font-semibold text-silent-white hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {emailOtp.verifying ? 'Verifying…' : 'Verify'}
                        </button>
                      </div>
                      <p className="mt-1 font-sans text-[11px] text-indian-red/40">We've emailed a 6-digit code to {form.email}.</p>
                    </div>
                  )}
                  {/* Not nested inside the `otpSent` block above — a failed
                      Send OTP call never sets otpSent, so the error would
                      otherwise never render and clicking the button would
                      look like it silently did nothing. */}
                  {emailOtp.error && <p className="mt-1 font-sans text-[11px] text-red-600">{emailOtp.error}</p>}
                </div>

                <div className="flex flex-col gap-2 sm:col-span-2">
                  <span data-cms-field={`${cmsPath}.fields.message`} className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.message}
                  </span>
                  <div className="relative">
                    <MessageSquare size={16} className={`${iconClass} top-3.5 translate-y-0`} />
                    <PlaceholderOverlay field={`${cmsPath}.placeholders.message`} empty={!form.message} text={placeholders.message} editing={editing} top="start" />
                    <textarea
                      rows={4}
                      aria-label={fields.message}
                      value={form.message}
                      onChange={(e) => update('message', e.target.value)}
                      className={`${fieldClass} resize-none`}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!emailOtp.verified || submitting}
                  onClick={(e) => {
                    // Editing the label span below shouldn't also submit the
                    // (empty) form and flip to the success state.
                    if (editing) e.preventDefault();
                  }}
                  className={`sm:col-span-2 mt-2 inline-flex items-center justify-center px-6 py-3.5 rounded-full font-sans text-sm font-medium transition-all ${
                    emailOtp.verified
                      ? 'bg-indian-red text-silent-white hover:opacity-90 hover:shadow-lg hover:shadow-indian-red/20 disabled:opacity-70'
                      : 'bg-indian-red/30 text-silent-white/70 cursor-not-allowed'
                  }`}
                >
                  {submitting ? 'Submitting…' : <span data-cms-field={`${cmsPath}.submitLabel`}>{submitLabel}</span>}
                </button>
                {!emailOtp.verified && (
                  <p className="sm:col-span-2 -mt-3 text-center font-sans text-xs text-indian-red/45">
                    Verify your email address to submit.
                  </p>
                )}
                {submitError && (
                  <p className="sm:col-span-2 -mt-3 text-center font-sans text-xs text-red-600">{submitError}</p>
                )}
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
