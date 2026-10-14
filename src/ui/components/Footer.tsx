import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Mail, MapPin, Instagram, Facebook, Linkedin, X as XIcon } from 'lucide-react';
import { getRecaptchaToken } from '../lib/recaptcha';
import MenuLabel from './MenuLabel';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

// Same base as every other form's submit call — ankur-client hosts the API
// route itself (same-origin relative fetch), ankur-admin points this at
// wherever ankur-client is running since it can't host the route on
// Cloudflare Workers.
const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.PUBLIC_OTP_API_BASE_URL ?? '';

const SOCIAL_ICONS: Record<string, typeof Instagram> = {
  Instagram: Instagram,
  Facebook: Facebook,
  LinkedIn: Linkedin,
  'X.com': XIcon,
};

export interface FooterLink {
  label: string;
  href: string;
  target?: string;
  titleAttr?: string;
  /** Menu item reference, edit mode only. */
  menuRef?: string;
}

export interface FooterColumn {
  title: string;
  menuRef?: string;
  links: FooterLink[];
}

export interface FooterContent {
  cta: {
    title: string;
    body: string;
    placeholder: string;
    buttonLabel: string;
  };
  brand: {
    logo: { src: string; alt: string };
    tagline: string;
    email: string;
    address: string;
    addressMapUrl?: string;
    cta: { label: string; href: string };
  };
  columns: FooterColumn[];
  legalLinks: FooterLink[];
  copyrightName: string;
}

export default function Footer({ content }: { content: FooterContent }) {
  const { cta, brand, columns, legalLinks, copyrightName } = content;
  const sectionRef = useRef<HTMLElement>(null);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // useLayoutEffect (not useEffect) applies the hidden starting state before
  // first paint — though on its own that's not sufficient, since Astro
  // paints the real, fully-visible copy well before this client:visible
  // island hydrates. The `pre-anim-hidden` class marks this section for the
  // global pre-hide rules in global.css (not a scoped <style> here — this
  // site uses Astro's <ClientRouter />, and a per-page stylesheet isn't
  // guaranteed loaded at the instant a page's HTML gets swapped in during a
  // soft navigation). BaseLayout's <noscript> block restores visibility if
  // JS never runs.
  //
  // fromTo (not .from) — with the CSS pre-hide already at opacity:0, a plain
  // .from() would read that same value as its current computed style and
  // treat it as the implicit target too, animating 0 -> 0 (a no-op) while
  // the y-offset still animated normally. No clearProps: none of these
  // elements (or the footer-card content below) have another rule fighting
  // for opacity/transform, so GSAP's final inline values are safe to leave
  // in place permanently.
  //
  // Previously this only covered the CTA band (mail icon, title, body,
  // form) — the footer card below (logo, columns, links) had no reveal at
  // all, hence the second batch on .ft-card-reveal.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      ScrollTrigger.batch('.ft-reveal', {
        start: 'top 90%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { y: 24, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.08 },
          ),
      });
      ScrollTrigger.batch('.ft-card-reveal', {
        start: 'top 90%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.6, ease: 'power2.out', stagger: 0.06 },
          ),
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const recaptchaToken = await getRecaptchaToken('newsletter_signup');
      const res = await fetch(`${API_BASE}/api/submit-newsletter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, recaptchaToken }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to submit');
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <footer ref={sectionRef} className="pre-anim-hidden relative">
      {/* CTA band */}
      <div className="relative bg-indian-red pt-20 lg:pt-24 pb-36 lg:pb-44 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'repeating-linear-gradient(90deg, #FFF6EB 0, #FFF6EB 1px, transparent 1px, transparent 28px)',
          }}
          aria-hidden="true"
        />

        <div className="relative max-w-[1280px] mx-auto px-6 lg:px-10">
          <div className="ft-reveal flex items-center justify-center w-11 h-11 rounded-xl bg-silent-white/10 border border-silent-white/20 mb-8">
            <Mail size={18} className="text-silent-white" />
          </div>

          <h2
            data-cms-field="cta.title"
            className="ft-reveal font-display font-medium text-silent-white text-3xl sm:text-4xl lg:text-5xl leading-[1.1] max-w-xl [text-wrap:balance]"
          >
            {cta.title}
          </h2>
          <p
            data-cms-field="cta.body"
            className="ft-reveal mt-5 font-sans text-silent-white/70 text-base leading-relaxed max-w-lg"
          >
            {cta.body}
          </p>

          <form onSubmit={handleSubmit} className="ft-reveal mt-8 flex flex-col sm:flex-row gap-3 max-w-lg">
            {submitted ? (
              <p className="font-sans text-sm text-silent-white/85 py-3.5">
                Thanks, we'll be in touch.
              </p>
            ) : (
              <>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={cta.placeholder}
                  data-cms-field="cta.placeholder"
                  className="flex-1 px-5 py-3.5 rounded-full bg-silent-white/15 border border-silent-white/25 text-silent-white placeholder:text-silent-white/50 text-sm outline-none focus:border-silent-white/50 transition-colors"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-silent-white text-indian-red font-sans text-sm font-medium hover:opacity-90 transition-opacity shrink-0 disabled:opacity-60"
                >
                  <span data-cms-field="cta.buttonLabel">{submitting ? 'Sending…' : cta.buttonLabel}</span>
                </button>
              </>
            )}
          </form>
          {submitError && <p className="ft-reveal mt-3 font-sans text-sm text-silent-white/85 max-w-lg">{submitError}</p>}
        </div>
      </div>

      {/* Footer card — pulled up over the CTA band */}
      <div className="relative -mt-24 lg:-mt-28 bg-silent-white rounded-t-[2rem] lg:rounded-t-[2.5rem] shadow-[0_-12px_40px_rgba(0,0,0,0.12)]">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-12 lg:pt-16 pb-12 grid grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)] gap-x-8 gap-y-12">
          <div className="ft-card-reveal col-span-2 lg:col-span-1">
            <img
              src={brand.logo.src}
              alt={brand.logo.alt}
              data-cms-image="brand.logo.src"
              className="h-9 w-auto"
            />
            <p
              data-cms-field="brand.tagline"
              className="mt-5 font-display font-medium text-indian-red text-2xl leading-snug max-w-[220px]"
            >
              {brand.tagline}
            </p>
            <div className="mt-5 space-y-2">
              <p className="flex items-center gap-2 font-sans text-sm text-indian-red/60">
                <Mail size={14} className="shrink-0" />
                <a href={`mailto:${brand.email}`} className="hover:underline">
                  <span data-cms-field="brand.email">{brand.email}</span>
                </a>
              </p>
              <p className="flex items-center gap-2 font-sans text-sm text-indian-red/60">
                <MapPin size={14} className="shrink-0" />
                {brand.addressMapUrl ? (
                  <a href={brand.addressMapUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    <span data-cms-field="brand.address">{brand.address}</span>
                  </a>
                ) : (
                  <span data-cms-field="brand.address">{brand.address}</span>
                )}
              </p>
            </div>
            <a
              href={brand.cta.href}
              data-cms-link="brand.cta.href"
              className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-indian-red text-silent-white font-sans text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <span data-cms-field="brand.cta.label">{brand.cta.label}</span>
              <span aria-hidden="true">&rarr;</span>
            </a>
          </div>

          {columns.map((column, c) => (
            <div key={c} className="ft-card-reveal">
              <h3
                className="font-sans text-sm font-semibold text-indian-red mb-4"
              >
                <MenuLabel menuRef={column.menuRef}>{column.title}</MenuLabel>
              </h3>
              <ul className="space-y-3">
                {column.links.map((link, l) => {
                  const Icon = column.title === 'Connect' ? SOCIAL_ICONS[link.label] : undefined;
                  const isExternal = /^https?:\/\//.test(link.href);
                  return (
                    <li key={l}>
                      <a
                        href={link.href}
                        target={link.target ?? (isExternal ? '_blank' : undefined)}
                        rel={(link.target ?? (isExternal ? '_blank' : undefined)) === '_blank' ? 'noopener noreferrer' : undefined}
                        title={link.titleAttr}
                        data-cms-menu-link={link.menuRef}
                        className="inline-flex items-center gap-2 font-sans text-sm text-indian-red/60 hover:text-indian-red transition-colors"
                      >
                        {Icon && <Icon size={14} className="shrink-0" />}
                        <span><MenuLabel menuRef={link.menuRef}>{link.label}</MenuLabel></span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-indian-red/10">
          <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-6 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {legalLinks.map((link, i) => (
                <a
                  key={i}
                  href={link.href}
                  target={link.target}
                  rel={link.target === "_blank" ? "noopener noreferrer" : undefined}
                  title={link.titleAttr}
                  data-cms-menu-link={link.menuRef}
                  className="font-sans text-xs text-indian-red/60 hover:text-indian-red transition-colors"
                >
                  <span><MenuLabel menuRef={link.menuRef}>{link.label}</MenuLabel></span>
                </a>
              ))}
            </div>
            <p className="font-sans text-xs text-indian-red/50">
              &copy; {new Date().getFullYear()}{' '}
              <span data-cms-field="copyrightName">{copyrightName}</span>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
