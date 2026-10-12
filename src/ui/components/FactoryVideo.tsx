import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Play } from 'lucide-react';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export interface FactoryVideoContent {
  eyebrow: string;
  title: string;
  items: { title: string; src: string; poster: string }[];
}

// Spotlight coverflow — same shape/behavior as Gallery.astro's "Watch"
// carousel (center slide large + dimmed neighbors peeking in from either
// side, autoplay, click a neighbor to bring it to center). Reimplemented
// here in React rather than reused directly since this component is a
// client:visible React island (like CertificationsStrip/DistributionMap)
// while Gallery's version is Astro + a vanilla <script>. Unlike Gallery's
// cards (YouTube links that open in a new tab), every item here is a local
// video file that plays inline — clicking the centered card plays it in
// place instead of navigating away.
const AUTOPLAY_MS = 4500;

export default function FactoryVideo({ content }: { content: FactoryVideoContent }) {
  const { eyebrow, title, items } = content;
  const sectionRef = useRef<HTMLElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hovering, setHovering] = useState(false);

  // Plain useLayoutEffect + gsap.context (not useGSAP) — same fix as
  // CertificationsStrip/DistributionMap: multiple client:visible islands on
  // this page calling the useGSAP hook broke React's hook dispatch.
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
  // fromTo (not .from) throughout — with the CSS pre-hide already at
  // opacity:0, a plain .from() would read that same value as its current
  // computed style and treat it as the implicit target too, animating 0 -> 0
  // (a no-op) while everything else still animated normally. No clearProps:
  // none of these elements have another rule fighting for opacity/transform
  // afterward, so GSAP's final inline values are safe to leave in place
  // permanently.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      ScrollTrigger.batch('.fv-heading > *', {
        start: 'top 80%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { y: 24, opacity: 0, filter: 'blur(10px)' },
            { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'power3.out', stagger: 0.1, delay: 0.15 },
          ),
      });
      ScrollTrigger.batch('.fv-carousel', {
        start: 'top 85%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(els, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out' }),
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  // Play/pause the one video element that's actually allowed to be
  // playing — the centered slide, and only once its card has been clicked.
  // Runs whenever the center slide or play state changes, so navigating
  // away (via nav buttons or clicking a neighbor) always stops playback
  // rather than leaving an off-center video running silently underneath.
  useEffect(() => {
    videoRefs.current.forEach((el, i) => {
      if (!el) return;
      if (playing && i === activeIndex) el.play().catch(() => {});
      else el.pause();
    });
  }, [activeIndex, playing]);

  // Auto-advance every few seconds, like a living showcase rather than a
  // static row — pauses while hovered or while the centered video is
  // actually playing, and skipped entirely for reduced-motion.
  useEffect(() => {
    if (items.length < 2 || hovering || playing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      setActiveIndex((i) => (i + 1) % items.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [items.length, hovering, playing]);

  function goTo(index: number) {
    setPlaying(false);
    setActiveIndex(index);
  }

  function handleSlideClick(index: number) {
    if (index === activeIndex) {
      if (!playing) setPlaying(true);
    } else {
      goTo(index);
    }
  }

  return (
    <section ref={sectionRef} className="pre-anim-hidden relative bg-indian-red overflow-hidden pt-10 pb-20 lg:pt-14 lg:pb-28">
      {/* Faint vertical-line texture — the only decoration on an otherwise
          flat dark section, echoing the same restrained "texture, not
          imagery" language as Hero's film-grain overlay. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: 'repeating-linear-gradient(90deg, #FFF6EB 0, #FFF6EB 1px, transparent 1px, transparent 28px)',
        }}
        aria-hidden="true"
      />

      <div className="relative max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="fv-heading text-center max-w-2xl mx-auto mb-12 lg:mb-16">
          <div className="mb-4">
            <span
              data-cms-field="factoryVideo.eyebrow"
              className="font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-silent-white/70"
            >
              {eyebrow}
            </span>
          </div>
          <h2
            data-cms-field="factoryVideo.title"
            className="font-display font-medium text-silent-white text-3xl sm:text-4xl lg:text-5xl leading-[1.1] [text-wrap:balance]"
          >
            {title}
          </h2>
        </div>

        <div
          className="fv-carousel relative h-[260px] sm:h-[340px] lg:h-[420px]"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          {items.map((item, i) => {
            let offset = i - activeIndex;
            if (offset > items.length / 2) offset -= items.length;
            if (offset < -items.length / 2) offset += items.length;

            const isCenter = offset === 0;
            const isNeighbor = offset === -1 || offset === 1;
            const isActivePlaying = isCenter && playing;

            const x = isNeighbor ? offset * 400 : 0;
            const y = isNeighbor ? 28 : 0;
            const scale = isCenter ? 1.15 : isNeighbor ? 0.75 : 0.6;
            const opacity = isCenter ? 1 : isNeighbor ? 0.55 : 0;
            const zIndex = isCenter ? 30 : isNeighbor ? 20 : 10;
            const brightness = isNeighbor ? 0.6 : 1;

            return (
              <div
                key={i}
                role="button"
                tabIndex={0}
                aria-label={item.title}
                onClick={() => handleSlideClick(i)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  handleSlideClick(i);
                }}
                className="absolute left-1/2 top-1/2 w-[340px] sm:w-[460px] lg:w-[580px] overflow-hidden rounded-2xl shadow-2xl ring-1 ring-silent-white/15 cursor-pointer transition-[transform,opacity,filter] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{
                  transform: `translate(-50%, -50%) translateX(${x}px) translateY(${y}px) scale(${scale})`,
                  opacity,
                  zIndex,
                  filter: `brightness(${brightness})`,
                  pointerEvents: opacity > 0 ? 'auto' : 'none',
                }}
              >
                <div className="relative aspect-video bg-black/20">
                  <img
                    data-cms-image={`factoryVideo.items[${i}].poster`}
                    src={item.poster}
                    alt=""
                    className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
                      isActivePlaying ? 'opacity-0 pointer-events-none' : 'opacity-100'
                    }`}
                  />

                  {/* Always mounted (not created on click) so the file stays
                      reachable to the CMS's video-picker in edit mode — only
                      preload="none" + no autoplay keep it from costing
                      anything until this slide is centered and clicked. */}
                  <video
                    ref={(el) => {
                      videoRefs.current[i] = el;
                    }}
                    data-cms-image={`factoryVideo.items[${i}].src`}
                    src={item.src}
                    controls={isActivePlaying}
                    playsInline
                    preload="none"
                    className={`absolute inset-0 h-full w-full object-cover ${
                      isActivePlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  />

                  {!isActivePlaying && (
                    <>
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span className="flex h-14 w-14 sm:h-16 sm:w-16 lg:h-20 lg:w-20 items-center justify-center rounded-full bg-silent-white/90 shadow-lg">
                          <Play size={26} fill="currentColor" className="translate-x-0.5 text-indian-red" />
                        </span>
                      </div>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-5 pb-4 pt-12">
                        <p
                          data-cms-field={`factoryVideo.items[${i}].title`}
                          className="truncate text-sm sm:text-base lg:text-lg font-medium text-silent-white"
                        >
                          {item.title}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {items.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => goTo((activeIndex - 1 + items.length) % items.length)}
                aria-label="Previous video"
                className="hidden sm:flex absolute left-2 lg:left-6 top-1/2 -translate-y-1/2 z-40 h-10 w-10 items-center justify-center rounded-full bg-silent-white/10 text-silent-white ring-1 ring-silent-white/20 transition-colors hover:bg-silent-white/20"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4"><path d="M15 6 9 12l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button
                type="button"
                onClick={() => goTo((activeIndex + 1) % items.length)}
                aria-label="Next video"
                className="hidden sm:flex absolute right-2 lg:right-6 top-1/2 -translate-y-1/2 z-40 h-10 w-10 items-center justify-center rounded-full bg-silent-white/10 text-silent-white ring-1 ring-silent-white/20 transition-colors hover:bg-silent-white/20"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
