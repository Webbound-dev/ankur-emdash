import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Play } from 'lucide-react';
import {
  AUDIO_ENGAGE_EVENT,
  AUDIO_GOTO_EVENT,
  AUDIO_TRACK_CHANGE_EVENT,
  TRACKS,
  getCurrentTrackIndex,
  type AudioGotoDetail,
  type AudioTrackChangeDetail,
} from './AudioPlayer';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export interface QuoteSlide {
  line: string;
  translation: string;
  attribution: string;
}

export interface QuoteSectionContent {
  eyebrow: string;
  // One slide per track in AudioPlayer's TRACKS array (same index) — the
  // dots below walk both in lockstep, so slides[i] is always the quote for
  // whichever track is currently playing.
  slides: QuoteSlide[];
  ctaLabel: string;
}

// The site's audio has exactly one entry point: this button. Pressing it
// launches a small clone that flies from here down to the fixed corner
// where AudioPlayer lives, then hands off — that persisted, global player
// owns all real playback state from that point on. This component only ever
// fires the engage event once per click; if the visitor navigated back to
// the homepage mid-session with audio already engaged (AudioPlayer's
// transition:persist instance is still mounted and playing), we detect that
// via its DOM node rather than duplicating any state, and skip straight to
// the "already playing" display instead of re-pitching Play. Nothing here
// persists across an actual reload — that's intentional, see AudioPlayer.
export default function QuoteSection({ content }: { content: QuoteSectionContent }) {
  const { eyebrow, slides, ctaLabel } = content;
  const sectionRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const slideContentRef = useRef<HTMLDivElement>(null);
  const [played, setPlayed] = useState(false);
  const [flying, setFlying] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [displayedSlideIndex, setDisplayedSlideIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'next' | 'prev'>('next');

  useEffect(() => {
    setPlayed(!!document.getElementById('ankur-audio-player'));
    // Read whatever track is already active (in case AudioPlayer switched
    // tracks earlier in this session, e.g. via the dots below, before this
    // section mounted) rather than assuming track one.
    const initialTrackIndex = getCurrentTrackIndex();
    setSlideIndex(initialTrackIndex);
    setDisplayedSlideIndex(initialTrackIndex);

    function onTrackChange(e: Event) {
      const detail = (e as CustomEvent<AudioTrackChangeDetail>).detail;
      setSlideDirection(detail.direction);
      setSlideIndex(detail.index);
    }
    document.addEventListener(AUDIO_TRACK_CHANGE_EVENT, onTrackChange);
    return () => document.removeEventListener(AUDIO_TRACK_CHANGE_EVENT, onTrackChange);
  }, []);

  // Slides the quote block (line/translation/attribution) out, swaps its
  // content once it's off-screen, then slides the new one in from the
  // opposite side — mirrors AudioPlayer's own "skip the very first render"
  // guard, since the mount effect above already set the right slide.
  const isFirstSlideRender = useRef(true);
  useEffect(() => {
    if (isFirstSlideRender.current) {
      isFirstSlideRender.current = false;
      return;
    }
    const el = slideContentRef.current;
    if (!el) return;
    const exitX = slideDirection === 'next' ? -28 : 28;
    gsap.to(el, {
      x: exitX,
      opacity: 0,
      duration: 0.28,
      ease: 'power2.in',
      onComplete: () => {
        setDisplayedSlideIndex(slideIndex);
        gsap.fromTo(el, { x: -exitX, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: 'power2.out' });
      },
    });
    // slideDirection intentionally excluded — setSlideDirection and
    // setSlideIndex are always called together in onTrackChange above, so
    // by the time this effect runs for a given slideIndex, slideDirection
    // already reflects that same change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideIndex]);

  // useLayoutEffect (not useEffect) — applies the hidden starting state
  // before the browser's first paint. That alone isn't enough on its own,
  // though: Astro paints the server-rendered, fully-visible copy well
  // before this island hydrates at all, so there's a real gap where the
  // finished text is on screen, unanimated, before GSAP even runs — the
  // `pre-anim-hidden` class marks this section for the global pre-hide rules
  // in global.css (not a scoped <style> here — this site uses Astro's
  // <ClientRouter />, and a per-page stylesheet isn't guaranteed loaded at
  // the instant a page's HTML gets swapped in during a soft navigation;
  // global.css is loaded once and stays resident for the whole session).
  // BaseLayout's <noscript> block restores visibility if JS never runs.
  //
  // fromTo (not .from) — with the CSS above pre-setting opacity:0, a plain
  // .from() would read that same 0 as its *current* value and treat it as
  // the implicit target too, animating opacity 0 -> 0 (a no-op) while
  // everything else still moved — exactly the bug this shipped with the
  // first time. Explicit "to" values in fromTo sidestep that. No clearProps
  // needed anywhere here: none of these elements have another CSS rule
  // (hover or otherwise) fighting for their opacity/transform/filter, so
  // GSAP's own final inline values are safe to leave in place permanently.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: sectionRef.current, start: 'top 85%', once: true },
      });
      tl.fromTo(
        '.qs-eyebrow-text',
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' },
      )
        .fromTo(
          '.qs-line',
          { opacity: 0, y: 36, filter: 'blur(10px)' },
          { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.1, ease: 'power3.out' },
          '<0.15',
        )
        .fromTo(
          '.qs-translation',
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' },
          '<0.5',
        )
        .fromTo('.qs-attribution', { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' }, '<0.2')
        .fromTo(
          '.qs-cta',
          { opacity: 0, scale: 0.7 },
          { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.7)' },
          '<0.1',
        );
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  function launch() {
    if (played || flying) return;
    const btn = buttonRef.current;
    if (!btn) return;

    const from = btn.getBoundingClientRect();
    const size = 48; // matches AudioPlayer's h-12 w-12 button
    const margin = 20; // matches AudioPlayer's bottom-5 right-5
    const toX = window.innerWidth - margin - size / 2;
    const toY = window.innerHeight - margin - size / 2;
    const fromX = from.left + from.width / 2;
    const fromY = from.top + from.height / 2;

    const clone = document.createElement('div');
    clone.className =
      'fixed z-[60] rounded-full bg-indian-red text-silent-white flex items-center justify-center shadow-2xl shadow-indian-red/40 pointer-events-none';
    clone.style.left = '0px';
    clone.style.top = '0px';
    clone.style.width = `${from.width}px`;
    clone.style.height = `${from.height}px`;
    clone.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';
    document.body.appendChild(clone);

    setFlying(true);
    gsap.set(clone, { x: fromX - from.width / 2, y: fromY - from.height / 2 });
    gsap.to(clone, {
      x: toX - from.width / 2,
      y: toY - from.height / 2,
      width: size,
      height: size,
      duration: 0.85,
      ease: 'power3.inOut',
      onComplete: () => {
        clone.remove();
        setPlayed(true);
        setFlying(false);
        document.dispatchEvent(new CustomEvent(AUDIO_ENGAGE_EVENT));
        // The button faded out below as the clone launched — bring it back
        // for its "already playing" state (equalizer bars) rather than
        // leaving it permanently at opacity:0 from the tween above.
        gsap.to(btn, { opacity: 1, scale: 1, duration: 0.4, ease: 'power2.out' });
      },
    });
    gsap.to(btn, { opacity: 0, scale: 0.85, duration: 0.35, ease: 'power2.out' });
  }

  const activeIndex = displayedSlideIndex % slides.length;
  const activeSlide = slides[activeIndex] ?? slides[0];

  return (
    <section
      ref={sectionRef}
      className="pre-anim-hidden relative overflow-hidden bg-gradient-to-b from-silent-white to-white pt-8 lg:pt-12 pb-16 lg:pb-20"
    >
      {/* Same restrained treatment as the brand-statement sections on Industrial
          Salt/Export/Quality pages — light break, faint pinstripe texture, a
          quote glyph, no gradient drama. This is the one instance of it with
          an interactive CTA, since it's also where site audio starts. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, #A82121 0, #A82121 1px, transparent 1px, transparent 28px)',
        }}
        aria-hidden="true"
      />

      <div className="relative max-w-2xl mx-auto px-6 text-center">
        <div className="mb-6">
          <span
            data-cms-field="quote.eyebrow"
            className="qs-eyebrow-text font-sans text-[11px] font-semibold uppercase tracking-[0.35em] text-indian-red/40"
          >
            {eyebrow}
          </span>
        </div>

        <svg viewBox="0 0 32 24" className="qs-eyebrow-text mx-auto h-8 w-8 text-indian-red/25">
          <path
            d="M0 24V13.5Q0 6 4 3T12 0V5Q8 6 6 9T4 14H10V24H0ZM18 24V13.5Q18 6 22 3T30 0V5Q26 6 24 9T22 14H28V24H18Z"
            fill="currentColor"
          />
        </svg>

        {/* Wrapper is what actually slides/fades between tracks (see the
            slideIndex effect above) — the reveal timeline above still
            targets the inner qs-line/qs-translation/qs-attribution classes
            directly for the section's initial scroll-into-view entrance. */}
        <div ref={slideContentRef}>
          <p
            data-cms-field={`quote.slides[${activeIndex}].line`}
            className="qs-line mt-4 font-display font-medium text-3xl sm:text-4xl lg:text-5xl leading-[1.15] text-indian-red [text-wrap:balance]"
          >
            {activeSlide.line}
          </p>
          <p
            data-cms-field={`quote.slides[${activeIndex}].translation`}
            className="qs-translation mt-4 font-sans italic text-base lg:text-lg text-indian-red/70"
          >
            {activeSlide.translation}
          </p>
          <p
            data-cms-field={`quote.slides[${activeIndex}].attribution`}
            className="qs-attribution mt-3 font-sans text-xs font-semibold uppercase tracking-widest text-indian-red/40"
          >
            {activeSlide.attribution}
          </p>
        </div>

        <div className="qs-cta mt-12 flex flex-col items-center gap-4">
          {!played && (
            <button
              ref={buttonRef}
              type="button"
              onClick={launch}
              disabled={flying}
              aria-label={`${ctaLabel} sound`}
              className="relative flex h-16 w-16 items-center justify-center rounded-full bg-indian-red text-silent-white shadow-lg shadow-indian-red/25 transition-all duration-300 ease-out hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indian-red/50 focus-visible:ring-offset-2 focus-visible:ring-offset-silent-white"
            >
              <Play size={22} strokeWidth={2} fill="currentColor" className="translate-x-0.5" />
            </button>
          )}
          {played && (
            <>
              <style>{`
                @keyframes ankur-eq-bar-lg {
                  0%, 100% { transform: scaleY(0.22); }
                  50% { transform: scaleY(1); }
                }
              `}</style>
              <span className="flex items-end justify-center gap-[14px] h-12 w-full max-w-[640px]" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                  <span
                    key={i}
                    className="w-[5px] rounded-full bg-indian-red/35"
                    style={{
                      height: '100%',
                      animation: `ankur-eq-bar-lg ${0.9 + i * 0.13}s ease-in-out infinite`,
                      animationDelay: `${i * 0.1}s`,
                    }}
                  />
                ))}
              </span>
            </>
          )}
          {!played && (
            <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.25em] text-indian-red/40" data-cms-field="quote.ctaLabel">
              {ctaLabel}
            </span>
          )}
        </div>

        {/* Track dots — replace the old fixed Prev/Next buttons. Shown
            regardless of play state (picking a dot before pressing Play
            just selects which track starts once you do); plain content at
            the bottom of the section rather than fixed-position, so it
            scrolls away with the rest of the section naturally instead of
            needing its own visibility tracking. */}
        {TRACKS.length > 1 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            {TRACKS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => document.dispatchEvent(new CustomEvent<AudioGotoDetail>(AUDIO_GOTO_EVENT, { detail: { index: i } }))}
                aria-label={`Play track ${i + 1}`}
                aria-current={i === activeIndex}
                className="group flex h-6 items-center justify-center px-1"
              >
                <span
                  className={`block rounded-full transition-all duration-300 ease-out ${
                    i === activeIndex
                      ? 'h-2 w-7 bg-indian-red shadow-[0_1px_6px_rgba(168,33,33,0.45)]'
                      : 'h-2 w-2 bg-indian-red/20 group-hover:bg-indian-red/40 group-hover:scale-125'
                  }`}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
