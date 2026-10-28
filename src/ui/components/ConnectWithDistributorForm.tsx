import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BadgeCheck, Mail, MapPin, MessageSquare, Phone, User, Zap } from 'lucide-react';
import { isEditModeActive, onEditModeChange } from '../lib/editMode';
import { useOtpVerification } from '../lib/useOtpVerification';
import { getRecaptchaToken } from '../lib/recaptcha';
import { t } from '../../lib/ui-strings';
import type { Locale } from '../../lib/i18n';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export interface ConnectWithDistributorContent {
  eyebrow: string;
  heading: string;
  intro: string;
  benefits: string[];
  fields: {
    name: string;
    phone: string;
    email: string;
    city: string;
    state: string;
    message: string;
  };
  placeholders: {
    name: string;
    phone: string;
    email: string;
    city: string;
    state: string;
    message: string;
  };
  submitLabel: string;
  successHeading: string;
  successMessage: string;
}

type FieldKey = keyof ConnectWithDistributorContent['fields'];

// Same base as useOtpVerification — ankur-client hosts the API route itself
// (same-origin relative fetch), ankur-admin points this at wherever
// ankur-client is running since it can't host the route on Cloudflare Workers.
const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.PUBLIC_OTP_API_BASE_URL ?? '';

const EMPTY_FORM: Record<FieldKey, string> = {
  name: '',
  phone: '',
  email: '',
  city: '',
  state: '',
  message: '',
};

// Icons stay code-level (not CMS-editable) — only the benefit copy itself
// comes from content. Order must match content.benefits. Same convention as
// BecomeDistributorForm's BENEFIT_ICONS.
const BENEFIT_ICONS = [BadgeCheck, MapPin, Zap];

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

// Submission has no backend yet, same as BecomeDistributorForm — this is the
// UI half of the requirement ahead of the admin/CRUD pass.
export default function ConnectWithDistributorForm({
  content,
  locale = 'en',
  skipEntranceAnimation,
}: {
  content: ConnectWithDistributorContent;
  /** Page language, for the interface text (src/lib/ui-strings.ts). */
  locale?: Locale;
  // Set when rendered inside DistributorFormsTabs — see the matching prop
  // on BecomeDistributorForm for why.
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
      tl.fromTo('.cwd-eyebrow-text', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 })
        .fromTo('.cwd-heading', { opacity: 0, y: 24, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8 }, '<0.15')
        .fromTo('.cwd-intro', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, '<0.3')
        .fromTo(
          '.cwd-benefit',
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.08 },
          '<0.1',
        )
        .fromTo(
          '.cwd-form-panel',
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

  const fieldClass =
    'w-full rounded-lg border border-indian-red/18 bg-white pl-10 pr-3.5 py-2.5 font-sans text-sm text-indian-red outline-none transition-shadow focus:border-indian-red/45 focus:ring-4 focus:ring-indian-red/[0.08]';
  const iconClass = 'absolute left-3.5 top-1/2 -translate-y-1/2 text-indian-red/35 pointer-events-none';
  // Wider right padding to clear the Send OTP/Verified control that sits
  // inside the email input, same technique as the leading-icon padding above.
  const emailFieldClass = fieldClass.replace('pr-3.5', 'pr-24');

  return (
    <section
      ref={sectionRef}
      id="connect-with-distributor"
      className={`${skipEntranceAnimation ? '' : 'pre-anim-hidden'} relative overflow-hidden bg-silent-white border-t border-indian-red/10 py-16 lg:py-24 scroll-mt-24`}
    >
      {/* Radiant spotlight + faint line texture — same treatment as
          BecomeDistributorForm above it. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 900px 500px at 15% 15%, rgba(168,33,33,0.14), transparent 60%)' }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 800px 500px at 100% 100%, rgba(168,33,33,0.10), transparent 60%)' }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: 'repeating-linear-gradient(90deg, #A82121 0, #A82121 1px, transparent 1px, transparent 28px)' }}
        aria-hidden="true"
      />

      <div className="relative max-w-[1100px] mx-auto px-6 lg:px-10 grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16 items-start">
        <div className="lg:sticky lg:top-28">
          <div className="mb-4">
            <span data-cms-field="connectWithDistributor.eyebrow" className="cwd-eyebrow-text font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-indian-red/60">
              {eyebrow}
            </span>
          </div>
          <h2
            data-cms-field="connectWithDistributor.heading"
            className="cwd-heading font-display font-medium text-indian-red text-3xl lg:text-4xl leading-[1.1] [text-wrap:balance]"
          >
            {heading}
          </h2>
          <p data-cms-field="connectWithDistributor.intro" className="cwd-intro mt-4 font-sans text-indian-red/65 text-sm lg:text-base leading-relaxed max-w-[420px]">
            {intro}
          </p>

          <ul className="mt-9 space-y-4">
            {benefits.map((text, i) => {
              const Icon = BENEFIT_ICONS[i % BENEFIT_ICONS.length];
              return (
                <li key={i} className="cwd-benefit flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indian-red/[0.08] text-indian-red">
                    <Icon size={16} />
                  </span>
                  <span data-cms-field={`connectWithDistributor.benefits[${i}]`} className="font-sans text-sm text-indian-red/70 leading-relaxed pt-1.5">
                    {text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="cwd-form-panel relative rounded-xl bg-white border border-indian-red/[0.09] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.18)] overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-indian-red/60 via-indian-red to-indian-red/60" aria-hidden="true" />

          <div className="p-6 lg:p-10">
            {submitted ? (
              <div className="py-10 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indian-red/[0.08] text-indian-red">
                  <BadgeCheck size={22} />
                </span>
                <p data-cms-field="connectWithDistributor.successHeading" className="mt-4 font-display font-medium text-xl text-indian-red">
                  {successHeading}
                </p>
                <p data-cms-field="connectWithDistributor.successMessage" className="mt-2 font-sans text-sm text-indian-red/65 max-w-[360px] mx-auto">
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
                    const recaptchaToken = await getRecaptchaToken('connect_distributor');
                    const res = await fetch(`${API_BASE}/api/submit-connect-distributor`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...form, recaptchaToken }),
                    });
                    const data = (await res.json()) as { ok?: boolean; error?: string };
                    if (!res.ok || !data.ok) throw new Error(data.error || t(locale, 'Failed to submit'));
                    setSubmitted(true);
                  } catch (err) {
                    setSubmitError(err instanceof Error ? err.message : t(locale, 'Failed to submit'));
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <span data-cms-field="connectWithDistributor.fields.name" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.name}
                  </span>
                  <div className="relative">
                    <User size={16} className={iconClass} />
                    <PlaceholderOverlay field="connectWithDistributor.placeholders.name" empty={!form.name} text={placeholders.name} editing={editing} />
                    <input required type="text" aria-label={fields.name} value={form.name} onChange={(e) => update('name', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span data-cms-field="connectWithDistributor.fields.phone" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.phone}
                  </span>
                  <div className="relative">
                    <Phone size={16} className={iconClass} />
                    <PlaceholderOverlay field="connectWithDistributor.placeholders.phone" empty={!form.phone} text={placeholders.phone} editing={editing} />
                    <input required type="tel" aria-label={fields.phone} value={form.phone} onChange={(e) => update('phone', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span data-cms-field="connectWithDistributor.fields.email" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.email}
                  </span>
                  <div className="relative">
                    <Mail size={16} className={iconClass} />
                    <PlaceholderOverlay field="connectWithDistributor.placeholders.email" empty={!form.email} text={placeholders.email} editing={editing} />
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
                        <BadgeCheck size={14} /> {t(locale, 'Verified')}
                      </span>
                    ) : (
                      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && (
                        <button
                          type="button"
                          disabled={emailOtp.sending}
                          onClick={() => emailOtp.sendOtp(form.email)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-indian-red/[0.08] px-2.5 py-1 font-sans text-xs font-semibold text-indian-red hover:bg-indian-red/[0.14] transition-colors disabled:opacity-50"
                        >
                          {emailOtp.sending ? t(locale, 'Sending…') : emailOtp.otpSent ? t(locale, 'Resend') : t(locale, 'Send OTP')}
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
                          placeholder={t(locale, '6-digit code')}
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
                          {emailOtp.verifying ? t(locale, 'Verifying…') : t(locale, 'Verify')}
                        </button>
                      </div>
                      <p className="mt-1 font-sans text-[11px] text-indian-red/40">{t(locale, "We've emailed a 6-digit code to {email}.", { email: form.email })}</p>
                    </div>
                  )}
                  {/* Not nested inside the `otpSent` block above — a failed
                      Send OTP call never sets otpSent, so the error would
                      otherwise never render and clicking the button would
                      look like it silently did nothing. */}
                  {emailOtp.error && <p className="mt-1 font-sans text-[11px] text-red-600">{emailOtp.error}</p>}
                </div>

                <div className="flex flex-col gap-2">
                  <span data-cms-field="connectWithDistributor.fields.city" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.city}
                  </span>
                  <div className="relative">
                    <MapPin size={16} className={iconClass} />
                    <PlaceholderOverlay field="connectWithDistributor.placeholders.city" empty={!form.city} text={placeholders.city} editing={editing} />
                    <input required type="text" aria-label={fields.city} value={form.city} onChange={(e) => update('city', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span data-cms-field="connectWithDistributor.fields.state" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.state}
                  </span>
                  <div className="relative">
                    <MapPin size={16} className={iconClass} />
                    <PlaceholderOverlay field="connectWithDistributor.placeholders.state" empty={!form.state} text={placeholders.state} editing={editing} />
                    <input required type="text" aria-label={fields.state} value={form.state} onChange={(e) => update('state', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:col-span-2">
                  <span data-cms-field="connectWithDistributor.fields.message" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.message}
                  </span>
                  <div className="relative">
                    <MessageSquare size={16} className={`${iconClass} top-3.5 translate-y-0`} />
                    <PlaceholderOverlay field="connectWithDistributor.placeholders.message" empty={!form.message} text={placeholders.message} editing={editing} top="start" />
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
                  {submitting ? t(locale, 'Submitting…') : <span data-cms-field="connectWithDistributor.submitLabel">{submitLabel}</span>}
                </button>
                {!emailOtp.verified && (
                  <p className="sm:col-span-2 -mt-3 text-center font-sans text-xs text-indian-red/45">
                    {t(locale, 'Verify your email address to submit.')}
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
