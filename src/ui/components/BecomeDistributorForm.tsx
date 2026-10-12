import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BadgeCheck, Building2, Mail, MapPin, MessageSquare, Phone, Truck, User, Zap } from 'lucide-react';
import { isEditModeActive, onEditModeChange } from '../lib/editMode';
import { useOtpVerification } from '../lib/useOtpVerification';
import { getRecaptchaToken } from '../lib/recaptcha';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export interface BecomeDistributorContent {
  eyebrow: string;
  heading: string;
  intro: string;
  benefits: string[];
  fields: {
    businessName: string;
    contactName: string;
    phone: string;
    email: string;
    city: string;
    state: string;
    message: string;
  };
  placeholders: {
    businessName: string;
    contactName: string;
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

type FieldKey = keyof BecomeDistributorContent['fields'];

// Same base as useOtpVerification — ankur-client hosts the API route itself
// (same-origin relative fetch), ankur-admin points this at wherever
// ankur-client is running since it can't host the route on Cloudflare Workers.
const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.PUBLIC_OTP_API_BASE_URL ?? '';

const EMPTY_FORM: Record<FieldKey, string> = {
  businessName: '',
  contactName: '',
  phone: '',
  email: '',
  city: '',
  state: '',
  message: '',
};

// Icons stay code-level (not CMS-editable) — only the benefit copy itself
// comes from content. Order must match content.benefits.
const BENEFIT_ICONS = [BadgeCheck, Truck, Zap];

// A native <input>/<textarea> placeholder is an attribute, not a text node,
// so the generic contenteditable system has nothing to hook into. Rendered
// as its own editable overlay instead — shown only while the field is
// empty, and only click-through-able outside of edit mode so visitors still
// land in the real field beneath it. Mirrors the same technique used for
// the hero search bar's placeholder in DistributorNetwork.tsx.
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

// Submission has no backend yet — this is the UI half of the requirement
// (application form) ahead of the admin/CRUD pass. It validates and shows a
// confirmed success state locally so the flow can be reviewed end to end
// before a real submit endpoint exists.
export default function BecomeDistributorForm({
  content,
  skipEntranceAnimation,
}: {
  content: BecomeDistributorContent;
  // Set when rendered inside DistributorFormsTabs — that wrapper shows/hides
  // this form via a tab click, not a scroll, and toggling display:none
  // leaves this section's own scroll-triggered entrance below with a
  // zero-size trigger it can never correctly re-fire on reveal. The tab
  // wrapper handles the reveal animation itself instead.
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

  // This section previously had no entrance animation at all. pre-anim-hidden
  // (global.css) hides these elements via plain CSS from the very first
  // paint — Astro/React paint the real, fully-visible copy well before this
  // client:load island hydrates, so without it there'd be a gap where the
  // finished section sits on screen unanimated before GSAP catches up and
  // yanks it back to hidden. fromTo (not .from) gives each tween an explicit
  // end value instead of letting GSAP infer one by reading the element's
  // current computed style — which, with the CSS pre-hide already at
  // opacity:0, would otherwise read "current == target == 0" and produce a
  // no-op. Safe to apply here (unlike DistributorNetwork's rows/pins above):
  // every element below is static CMS content, nothing here is ever added
  // dynamically at runtime.
  useLayoutEffect(() => {
    if (skipEntranceAnimation) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: sectionRef.current, start: 'top 80%', once: true },
        defaults: { ease: 'power3.out' },
      });
      tl.fromTo('.bdf-eyebrow-text', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 })
        .fromTo('.bdf-heading', { opacity: 0, y: 24, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8 }, '<0.15')
        .fromTo('.bdf-intro', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, '<0.3')
        .fromTo(
          '.bdf-benefit',
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.08 },
          '<0.1',
        )
        .fromTo(
          '.bdf-form-panel',
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
  // change — the same signature as shadcn's Input/Textarea primitives. Left
  // padding is bumped to clear the leading icon every field now carries.
  const fieldClass =
    'w-full rounded-lg border border-indian-red/18 bg-white pl-10 pr-3.5 py-2.5 font-sans text-sm text-indian-red outline-none transition-shadow focus:border-indian-red/45 focus:ring-4 focus:ring-indian-red/[0.08]';
  const iconClass = 'absolute left-3.5 top-1/2 -translate-y-1/2 text-indian-red/35 pointer-events-none';
  // Wider right padding to clear the Send OTP/Verified control that sits
  // inside the email input, same technique as the leading-icon padding above.
  const emailFieldClass = fieldClass.replace('pr-3.5', 'pr-24');

  return (
    <section
      ref={sectionRef}
      id="become-a-distributor"
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
            <span data-cms-field="becomeDistributor.eyebrow" className="bdf-eyebrow-text font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-indian-red/60">
              {eyebrow}
            </span>
          </div>
          <h2
            data-cms-field="becomeDistributor.heading"
            className="bdf-heading font-display font-medium text-indian-red text-3xl lg:text-4xl leading-[1.1] [text-wrap:balance]"
          >
            {heading}
          </h2>
          <p data-cms-field="becomeDistributor.intro" className="bdf-intro mt-4 font-sans text-indian-red/65 text-sm lg:text-base leading-relaxed max-w-[420px]">
            {intro}
          </p>

          <ul className="mt-9 space-y-4">
            {benefits.map((text, i) => {
              const Icon = BENEFIT_ICONS[i % BENEFIT_ICONS.length];
              return (
                <li key={i} className="bdf-benefit flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indian-red/[0.08] text-indian-red">
                    <Icon size={16} />
                  </span>
                  <span data-cms-field={`becomeDistributor.benefits[${i}]`} className="font-sans text-sm text-indian-red/70 leading-relaxed pt-1.5">
                    {text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="bdf-form-panel relative rounded-xl bg-white border border-indian-red/[0.09] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.18)] overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-indian-red/60 via-indian-red to-indian-red/60" aria-hidden="true" />

          <div className="p-6 lg:p-10">
            {submitted ? (
              <div className="py-10 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indian-red/[0.08] text-indian-red">
                  <BadgeCheck size={22} />
                </span>
                <p data-cms-field="becomeDistributor.successHeading" className="mt-4 font-display font-medium text-xl text-indian-red">
                  {successHeading}
                </p>
                <p data-cms-field="becomeDistributor.successMessage" className="mt-2 font-sans text-sm text-indian-red/65 max-w-[360px] mx-auto">
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
                    const recaptchaToken = await getRecaptchaToken('distributor_application');
                    const res = await fetch(`${API_BASE}/api/submit-distributor-application`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...form, recaptchaToken }),
                    });
                    const data = (await res.json()) as { ok?: boolean; error?: string };
                    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to submit application');
                    setSubmitted(true);
                  } catch (err) {
                    setSubmitError(err instanceof Error ? err.message : 'Failed to submit application');
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <span data-cms-field="becomeDistributor.fields.businessName" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.businessName}
                  </span>
                  <div className="relative">
                    <Building2 size={16} className={iconClass} />
                    <PlaceholderOverlay field="becomeDistributor.placeholders.businessName" empty={!form.businessName} text={placeholders.businessName} editing={editing} />
                    <input required type="text" aria-label={fields.businessName} value={form.businessName} onChange={(e) => update('businessName', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span data-cms-field="becomeDistributor.fields.contactName" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.contactName}
                  </span>
                  <div className="relative">
                    <User size={16} className={iconClass} />
                    <PlaceholderOverlay field="becomeDistributor.placeholders.contactName" empty={!form.contactName} text={placeholders.contactName} editing={editing} />
                    <input required type="text" aria-label={fields.contactName} value={form.contactName} onChange={(e) => update('contactName', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span data-cms-field="becomeDistributor.fields.phone" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.phone}
                  </span>
                  <div className="relative">
                    <Phone size={16} className={iconClass} />
                    <PlaceholderOverlay field="becomeDistributor.placeholders.phone" empty={!form.phone} text={placeholders.phone} editing={editing} />
                    <input required type="tel" aria-label={fields.phone} value={form.phone} onChange={(e) => update('phone', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:col-span-2">
                  <span data-cms-field="becomeDistributor.fields.email" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.email}
                  </span>
                  <div className="relative">
                    <Mail size={16} className={iconClass} />
                    <PlaceholderOverlay field="becomeDistributor.placeholders.email" empty={!form.email} text={placeholders.email} editing={editing} />
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

                <div className="flex flex-col gap-2">
                  <span data-cms-field="becomeDistributor.fields.city" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.city}
                  </span>
                  <div className="relative">
                    <MapPin size={16} className={iconClass} />
                    <PlaceholderOverlay field="becomeDistributor.placeholders.city" empty={!form.city} text={placeholders.city} editing={editing} />
                    <input required type="text" aria-label={fields.city} value={form.city} onChange={(e) => update('city', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span data-cms-field="becomeDistributor.fields.state" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.state}
                  </span>
                  <div className="relative">
                    <MapPin size={16} className={iconClass} />
                    <PlaceholderOverlay field="becomeDistributor.placeholders.state" empty={!form.state} text={placeholders.state} editing={editing} />
                    <input required type="text" aria-label={fields.state} value={form.state} onChange={(e) => update('state', e.target.value)} className={fieldClass} />
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:col-span-2">
                  <span data-cms-field="becomeDistributor.fields.message" className="font-sans text-sm font-medium text-indian-red/80">
                    {fields.message}
                  </span>
                  <div className="relative">
                    <MessageSquare size={16} className={`${iconClass} top-3.5 translate-y-0`} />
                    <PlaceholderOverlay field="becomeDistributor.placeholders.message" empty={!form.message} text={placeholders.message} editing={editing} top="start" />
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
                  {submitting ? 'Submitting…' : <span data-cms-field="becomeDistributor.submitLabel">{submitLabel}</span>}
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
