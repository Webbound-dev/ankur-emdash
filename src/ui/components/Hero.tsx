import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { t } from '../../lib/ui-strings';
import type { Locale } from '../../lib/i18n';

export interface HeroSlide {
  eyebrow: string;
  title: string;
  body: string;
  cta: { label: string; href: string };
  media: { type: 'video'; src: string; poster: string } | { type: 'image'; src: string; alt?: string };
}

export interface HeroContent {
  slides: HeroSlide[];
  badge: { line1: string; line2: string };
}

const AUTOPLAY_MS = 6500;

export default function Hero({ content, locale = 'en' }: { content: HeroContent; locale?: Locale }) {
  const { slides, badge } = content;
  const [active, setActive] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  // Restarts on every change (autoplay tick or manual dot click) so a
  // manual click always buys a full interval before the next auto-advance.
  useEffect(() => {
    const timer = setInterval(() => {
      setActive((i) => (i + 1) % slides.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [active, slides.length]);

  // On-load entrance for the hero copy — same fade + rise language already
  // used for the scroll reveals elsewhere on this page, just run on mount
  // instead of a ScrollTrigger since this section is on screen immediately.
  // The title also un-blurs as it settles, echoing the same blur-in used on
  // QuoteSection's line.
  //
  // The hidden starting state can't be applied by GSAP alone (via useEffect
  // *or* useLayoutEffect) — Astro renders and paints the real, fully-visible
  // copy well before client:load finishes fetching/hydrating this island, so
  // there's a real gap (measured ~0.4-0.7s in dev, shorter but nonzero in a
  // production build) where the page shows the finished text, then GSAP
  // suddenly yanks it back to hidden and replays the entrance. The
  // `pre-anim-hidden` class marks this section for the global pre-hide rules
  // in global.css (present in the server-rendered HTML from the very first
  // paint, so the copy is already hidden before any JS runs) — GSAP then
  // just animates from that same state, seamlessly. Those rules live in
  // global.css rather than a scoped <style> here so they're guaranteed
  // active regardless of which page loads first or how a visitor navigates
  // in (this site uses Astro's <ClientRouter />, and a per-page stylesheet
  // isn't guaranteed loaded at the instant that page's HTML gets swapped in
  // during a soft transition). BaseLayout's <noscript> block restores
  // visibility if JS never runs at all.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onComplete: () => {
          // Drop the CSS pre-hide once and for all, then clear GSAP's own
          // inline styles — in that order, so nothing snaps back to hidden.
          // Needed for real: .hero-cta relies on a CSS :hover rule for its
          // hover state, which a leftover inline opacity would permanently
          // block.
          sectionRef.current?.classList.remove('pre-anim-hidden');
          gsap.set(['.hero-eyebrow-text', '.hero-title', '.hero-body', '.hero-cta'], {
            clearProps: 'all',
          });
        },
      });
      // fromTo (not .from) — .from() infers its end value by reading the
      // element's *current* computed style, but that current style is
      // opacity:0 (the pre-hide CSS rule above), so it was reading "already
      // 0" as the target and animating opacity 0 -> 0, a no-op. Everything
      // else (transform/filter) animated fine since nothing else pinned
      // those, which is what made this bug easy to miss — text visibly
      // moved and un-blurred while staying fully transparent, then popped
      // into view all at once when clearProps ran at the end.
      tl.fromTo('.hero-eyebrow-text', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 })
        .fromTo(
          '.hero-title',
          { opacity: 0, y: 30, filter: 'blur(10px)' },
          { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.9 },
          '<0.15',
        )
        .fromTo('.hero-body', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, '<0.3')
        .fromTo('.hero-cta', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6 }, '<0.15');
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="pre-anim-hidden relative overflow-hidden min-h-[calc(100vh-81px)] bg-indian-red">
      {/* Background — every slide's media is mounted from the start (not
          swapped on demand), so all of it starts downloading immediately on
          page load and is already cached by the time a slide goes active.
          Crossfaded by opacity, same technique as the text below — without
          this, the incoming image/video visibly lagged behind the text on
          anything but a fast connection ("out of sync" pop-in). */}
      {slides.map((slide, i) => (
        <div
          key={i}
          className={`absolute inset-0 transition-opacity duration-700 ${
            i === active ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {slide.media.type === 'video' ? (
            <video
              className="w-full h-full object-cover"
              src={slide.media.src}
              poster={slide.media.poster}
              autoPlay
              loop
              muted
              playsInline
              aria-hidden="true"
            />
          ) : (
            <img
              className="w-full h-full object-cover"
              src={slide.media.src}
              alt={slide.media.alt ?? ''}
              width={1920}
              height={1280}
              aria-hidden="true"
              // Every slide's media downloads immediately (see comment
              // above), but only slide 0 is ever the first paint — the rest
              // shouldn't compete with it (or the poster preload BaseLayout
              // adds for slide 0) for bandwidth on the initial load.
              loading={i === 0 ? 'eager' : 'lazy'}
              fetchPriority={i === 0 ? 'high' : 'low'}
            />
          )}
        </div>
      ))}

      {/* Brand-tinted scrim — heaviest toward the text zone at the bottom,
          but still carries real tint at the top so the footage never washes
          out to a bare, colorless patch under the navbar. */}
      <div className="absolute inset-0 bg-gradient-to-t from-indian-red/95 via-indian-red/40 to-black/35" />
      <div className="absolute top-0 inset-x-0 h-48 bg-gradient-to-b from-black/45 to-transparent" />
      {/* Fine grain, for a touch of film/print texture rather than a flat digital gradient */}
      <div
        className="absolute inset-0 opacity-[0.06] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* Heritage seal */}
      <div className="absolute top-28 right-6 lg:top-32 lg:right-10 z-10 w-20 h-20 lg:w-24 lg:h-24 rotate-[8deg] rounded-full bg-silent-white/10 backdrop-blur-sm border-[1.5px] border-dashed border-silent-white/60 shadow-lg flex flex-col items-center justify-center">
        <span
          data-cms-field="hero.badge.line1"
          className="font-display text-[9px] lg:text-[10px] font-semibold uppercase tracking-[0.15em] text-silent-white"
        >
          {badge.line1}
        </span>
        <span data-cms-field="hero.badge.line2" className="font-display text-lg lg:text-xl font-semibold text-silent-white">
          {badge.line2}
        </span>
      </div>

      {/* Slides — all mounted at once (crossfaded by opacity) so every
          slide's fields stay in the DOM and editable, not just the active one.
          Vertically centered in the full section (not bottom-anchored) so it
          self-balances with breathing room above and below regardless of
          viewport height or how long the copy is — and can never grow the
          section itself, since it's absolutely positioned. */}
      <div className="absolute inset-0 z-10 flex items-center">
        <div className="w-full max-w-[1280px] mx-auto px-6 lg:px-10">
        {/* Fixed-height, all slides always absolute/top-anchored (never
            toggled to `relative`) — a 2-line title and a 3-line title used
            to resize this box the instant the active index flipped, so the
            whole centered block visibly snapped to a new vertical position
            in the same frame as the fade. Now the box never changes size,
            so only opacity/position animate, nothing snaps. */}
        <div className="relative max-w-2xl min-h-[380px] sm:min-h-[360px] lg:min-h-[440px]">
          {slides.map((slide, i) => {
            // One <h1> per page: the first slide's title is the page heading,
            // the slides after it are secondary.
            const Title = i === 0 ? 'h1' : 'h2';
            return (
            <div
              key={i}
              // Incoming rises 0.75rem while fading in; outgoing sinks the
              // same distance while fading out — a consistent motion instead
              // of a flat opacity cut, and staggered (incoming delayed) so
              // two different messages never sit legibly on top of each
              // other mid-transition.
              className={`absolute inset-x-0 top-0 transition-all ease-out ${
                i === active
                  ? 'duration-700 delay-150 opacity-100 translate-y-0'
                  : 'duration-400 opacity-0 translate-y-3 pointer-events-none'
              }`}
            >
              <div className="mb-6">
                <span
                  data-cms-field={`hero.slides[${i}].eyebrow`}
                  className="hero-eyebrow-text font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-silent-white/85"
                >
                  {slide.eyebrow}
                </span>
              </div>

              <Title
                data-cms-field={`hero.slides[${i}].title`}
                className="hero-title font-display font-medium text-silent-white text-5xl sm:text-6xl lg:text-7xl leading-[1.05] mb-6 [text-wrap:balance]"
              >
                {slide.title}
              </Title>

              <p
                data-cms-field={`hero.slides[${i}].body`}
                className="hero-body font-sans font-light text-silent-white/85 text-base lg:text-lg leading-relaxed max-w-md mb-10"
              >
                {slide.body}
              </p>

              <a
                href={slide.cta.href}
                data-cms-link={`hero.slides[${i}].cta.href`}
                className="hero-cta inline-flex items-center px-7 py-3.5 rounded-full bg-silent-white text-indian-red font-sans text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <span data-cms-field={`hero.slides[${i}].cta.label`}>{slide.cta.label}</span>
              </a>
            </div>
            );
          })}
        </div>
        </div>
      </div>

      {/* Bottom wave — asymmetric (Amul reference): moderate at the left
          edge, dips down to nearly touch bottom left-of-center, then sweeps
          up high toward the right. Not a symmetric dome. Silent-white so it
          reads as a transition into the light section that follows (the
          homepage quote section), not a stray light strip. Sized to match
          the site's other wave dividers (h-14/h-20/h-28, e.g. Industrial
          Salt) — this one used to run much taller, which meant a lot of
          solid, texture-less cream sat between the wave and the quote
          section's actual pinstripe pattern before anything from that
          section was visible. */}
      <svg
        className="absolute bottom-0 inset-x-0 z-20 w-full h-14 sm:h-20 lg:h-28 text-silent-white"
        viewBox="0 0 1440 200"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M0,120 C480,220 960,-40 1440,40 L1440,200 L0,200 Z" fill="currentColor" />
      </svg>

      {/* Same pinstripe pattern as the quote section below, masked to the
          wave's own shape (same path, same viewBox scaling) so the lines
          run continuously from inside the curve straight into the section
          — instead of the wave being a solid, pattern-less gap before the
          "real" texture starts underneath it. Pixel-based background (not
          SVG-unit-based), so the 28px line spacing matches the section's
          exactly regardless of viewport width. */}
      <div
        className="absolute bottom-0 inset-x-0 z-20 w-full h-14 sm:h-20 lg:h-28 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, #A82121 0, #A82121 1px, transparent 1px, transparent 28px)',
          opacity: 0.05,
          WebkitMaskImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 200' preserveAspectRatio='none'%3E%3Cpath d='M0,120 C480,220 960,-40 1440,40 L1440,200 L0,200 Z' fill='white'/%3E%3C/svg%3E\")",
          maskImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 200' preserveAspectRatio='none'%3E%3Cpath d='M0,120 C480,220 960,-40 1440,40 L1440,200 L0,200 Z' fill='white'/%3E%3C/svg%3E\")",
          WebkitMaskSize: '100% 100%',
          maskSize: '100% 100%',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
        }}
        aria-hidden="true"
      />

      {/* Slide dots — silent-white based (not indian-red) since they now
          sit directly on the dark hero/wave rather than a light strip. */}
      {slides.length > 1 && (
        <div className="absolute bottom-4 sm:bottom-6 lg:bottom-8 right-6 sm:right-10 lg:right-16 z-30 flex gap-2.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              aria-label={t(locale, 'Show slide {n}', { n: i + 1 })}
              className={`w-2.5 h-2.5 rounded-full border border-silent-white/50 transition-colors ${
                i === active ? 'bg-silent-white' : 'bg-transparent hover:bg-silent-white/20'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
