import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export interface Certification {
  name: string;
  logo: { src: string; alt: string };
  certificateUrl?: string;
}

export interface CertificationsStripContent {
  certifications: Certification[];
}

export default function CertificationsStrip({ content }: { content: CertificationsStripContent }) {
  const { certifications } = content;
  const sectionRef = useRef<HTMLElement>(null);

  // Plain useLayoutEffect + gsap.context (not the useGSAP hook) — having two
  // separate islands on this page both call useGSAP broke React's hook
  // dispatch (a real conflict between @gsap/react and Astro's multi-island
  // hydration, not a caching issue). gsap.context() gives the same
  // auto-cleanup on unmount without touching the hook at all. useLayoutEffect
  // (not useEffect) applies the hidden starting state before first paint —
  // though on its own that's not sufficient, since Astro paints the real,
  // fully-visible badges well before this client:visible island hydrates.
  // The `pre-anim-hidden` class marks this section for the global pre-hide
  // rules in global.css (not a scoped <style> here — this site uses Astro's
  // <ClientRouter />, and a per-page stylesheet isn't guaranteed loaded at
  // the instant a page's HTML gets swapped in during a soft navigation).
  // BaseLayout's <noscript> block restores visibility if JS never runs.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      // ScrollTrigger.batch (not a single gsap.from + scrollTrigger config)
      // — the latter left this animation permanently stuck mid-tween on a
      // page with lots of async image loads shifting layout underneath it.
      //
      // fromTo (not .from) — with the CSS pre-hide already at opacity:0, a
      // plain .from() would read that same 0 as its current computed value
      // and treat it as the implicit target too, animating 0 -> 0 (a
      // no-op) while the y-offset still animated normally. Target opacity
      // is 0.5, not 1 — these badges rest at Tailwind's opacity-50 (muted
      // until hovered), so animating in to full opacity would visibly snap
      // back down to 0.5 the instant the tween ended. onComplete then
      // removes the pre-hide class *before* clearProps, in that order —
      // clearProps alone, with the class still attached, would just let the
      // still-matching CSS rule snap opacity back to 0 (fully invisible)
      // the instant GSAP's own inline value was removed.
      ScrollTrigger.batch('.cert-badge', {
        start: 'top 85%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { opacity: 0, y: 20 },
            {
              opacity: 0.5,
              y: 0,
              duration: 0.6,
              ease: 'power2.out',
              stagger: 0.08,
              onComplete: () => {
                sectionRef.current?.classList.remove('pre-anim-hidden');
                gsap.set('.cert-badge', { clearProps: 'all' });
              },
            },
          ),
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="pre-anim-hidden bg-silent-white border-t border-indian-red/10 py-12 lg:py-16">
      {/* No visible copy per spec — just a screen-reader label for context. */}
      <h2 className="sr-only">Certifications and awards</h2>
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        {/* Flat logo wall — no decorative frames or wrappers around the
            marks themselves (appropriate for official certification logos:
            displayed as-is, not boxed into a house style). Grayscale at
            rest, full color on hover — the same "muted until you engage"
            language used elsewhere on the site (product photography), so
            this reads as one system rather than a bolted-on afterthought. */}
        <div className="flex flex-wrap items-center justify-center lg:justify-between gap-x-16 gap-y-8">
          {certifications.map((cert, i) => {
            const badgeClass = 'cert-badge shrink-0 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all duration-300';
            const logo = (
              <img
                src={cert.logo.src}
                alt={cert.logo.alt}
                data-cms-image={`certificationsStrip.certifications[${i}].logo.src`}
                width={540}
                height={268}
                className="h-10 lg:h-14 w-auto max-w-[140px] object-contain"
                loading="lazy"
              />
            );
            return cert.certificateUrl ? (
              <a
                key={i}
                href={cert.certificateUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-cms-link={`certificationsStrip.certifications[${i}].certificateUrl`}
                className={badgeClass}
                title={`${cert.name} — view certificate`}
              >
                {logo}
              </a>
            ) : (
              <div key={i} className={badgeClass} title={cert.name}>
                {logo}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
