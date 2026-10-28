import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { t } from '../../lib/ui-strings';
import type { Locale } from '../../lib/i18n';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export interface BlogPost {
  tag: string;
  date: string;
  author: string;
  title: string;
  excerpt: string;
  image: { src: string; alt: string };
  href: string;
}

export interface BlogTeaserContent {
  eyebrow: string;
  title: string;
  viewAll: { label: string; href: string };
  posts: BlogPost[];
}

export default function BlogTeaser({ content, locale = 'en' }: { content: BlogTeaserContent; locale?: Locale }) {
  const { eyebrow, title, viewAll, posts } = content;
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Plain useLayoutEffect + gsap.context (not useGSAP) — same fix as
  // CertificationsStrip/DistributionMap/FactoryVideo: this page mounts
  // several client:visible islands, and more than one calling the useGSAP
  // hook broke React's hook dispatch. useLayoutEffect (not useEffect)
  // applies the hidden starting state before first paint — though on its
  // own that's not sufficient, since Astro paints the real, fully-visible
  // copy well before this client:visible island hydrates. The
  // `pre-anim-hidden` class marks this section for the global pre-hide
  // rules in global.css (not a scoped <style> here — this site uses Astro's
  // <ClientRouter />, and a per-page stylesheet isn't guaranteed loaded at
  // the instant a page's HTML gets swapped in during a soft navigation).
  // BaseLayout's <noscript> block restores visibility if JS never runs.
  //
  // fromTo (not .from) throughout — with the CSS pre-hide already at
  // opacity:0 (or scaleX:0 for the rule), a plain .from() would read that
  // same value as its current computed style and treat it as the implicit
  // target too, animating 0 -> 0 (a no-op) while everything else still
  // animated normally. No clearProps: none of these elements have another
  // rule fighting for opacity/transform/filter, so GSAP's final inline
  // values are safe to leave in place permanently.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      ScrollTrigger.batch('.bt-heading > *', {
        start: 'top 80%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { y: 24, opacity: 0, filter: 'blur(10px)' },
            { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'power3.out', stagger: 0.1, delay: 0.15 },
          ),
      });
      ScrollTrigger.batch('.bt-card', {
        start: 'top 88%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { y: 48, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', stagger: 0.12 },
          ),
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  function scrollByCard(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('.bt-card');
    const step = card ? card.getBoundingClientRect().width + 24 : 320;
    track.scrollBy({ left: direction * step, behavior: 'smooth' });
  }

  return (
    <section ref={sectionRef} className="pre-anim-hidden relative bg-indian-red/[0.03] py-20 lg:py-28 overflow-hidden">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-12 lg:mb-16">
          <div className="bt-heading">
            <div className="mb-4">
              <span
                data-cms-field="blogTeaser.eyebrow"
                className="font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-indian-red/70"
              >
                {eyebrow}
              </span>
            </div>
            <h2
              data-cms-field="blogTeaser.title"
              className="font-display font-medium text-indian-red text-3xl sm:text-4xl lg:text-5xl leading-[1.1]"
            >
              {title}
            </h2>
          </div>

          <div className="hidden lg:flex items-center gap-3 shrink-0">
            <a
              href={viewAll.href}
              data-cms-link="blogTeaser.viewAll.href"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-indian-red/25 text-indian-red font-sans text-sm font-medium hover:bg-indian-red hover:text-silent-white hover:border-indian-red transition-colors"
            >
              <span data-cms-field="blogTeaser.viewAll.label">{viewAll.label}</span>
              <span aria-hidden="true">&rarr;</span>
            </a>

            {/* Prev/next — a designed affordance for the scroll row, not
                left to a raw drag/swipe visitors have to discover on their own. */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scrollByCard(-1)}
                aria-label={t(locale, 'Previous article')}
                className="flex items-center justify-center w-11 h-11 rounded-full border border-indian-red/25 text-indian-red hover:bg-indian-red hover:text-silent-white hover:border-indian-red transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => scrollByCard(1)}
                aria-label={t(locale, 'Next article')}
                className="flex items-center justify-center w-11 h-11 rounded-full border border-indian-red/25 text-indian-red hover:bg-indian-red hover:text-silent-white hover:border-indian-red transition-colors"
              >
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bleeds past the section's own padding so the last card can peek off
          the right edge — a horizontally scrollable teaser row, not a fixed
          grid, so it reads as "here's a slice of the blog" rather than
          "here are exactly four posts." No scroll-snap here on purpose —
          snap-align on the first card fights the leading gutter and
          scrolls it away on load (eats the left inset every time). */}
      <div className="-mx-6 lg:-mx-10">
        <div ref={trackRef} className="flex gap-6 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="shrink-0 w-6 lg:w-10" aria-hidden="true" />
          {posts.map((post, i) => (
            <a
              key={i}
              href={post.href}
              data-cms-link={`blogTeaser.posts[${i}].href`}
              className="bt-card group shrink-0 w-[280px] sm:w-[320px] block"
            >
              {/* Same permanent brand-tint wash used on the product cards
                  above — ties the two photo grids into one visual system
                  instead of the blog reading like a bolted-on stock-photo grid. */}
              <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-indian-red/5 shadow-sm group-hover:shadow-xl transition-shadow duration-300">
                <img
                  src={post.image.src}
                  alt={post.image.alt}
                  data-cms-image={`blogTeaser.posts[${i}].image.src`}
                  width={1254}
                  height={1254}
                  className="w-full h-full object-cover group-hover:scale-[1.06] transition-transform duration-700 ease-out"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-indian-red/40 via-transparent to-indian-red/5 mix-blend-multiply" />
                <span
                  data-cms-field={`blogTeaser.posts[${i}].tag`}
                  className="absolute top-4 left-4 px-3 py-1 rounded-full bg-silent-white/90 backdrop-blur-sm font-sans text-[10px] font-bold uppercase tracking-[0.18em] text-indian-red"
                >
                  {post.tag}
                </span>
              </div>

              <div className="mt-5 transition-transform duration-300 group-hover:-translate-y-1">
                <p className="font-sans text-xs text-indian-red/50">
                  <span data-cms-field={`blogTeaser.posts[${i}].date`}>{post.date}</span>
                  {' • '}
                  <span data-cms-field={`blogTeaser.posts[${i}].author`}>{post.author}</span>
                </p>
                <h3
                  data-cms-field={`blogTeaser.posts[${i}].title`}
                  className="mt-2 inline font-display font-medium text-indian-red text-xl lg:text-[1.375rem] leading-snug bg-[linear-gradient(currentColor,currentColor)] bg-no-repeat bg-[length:0%_1.5px] group-hover:bg-[length:100%_1.5px] bg-[position:0_100%] transition-[background-size] duration-300"
                >
                  {post.title}
                </h3>
                <p
                  data-cms-field={`blogTeaser.posts[${i}].excerpt`}
                  className="mt-2 font-sans text-sm text-indian-red/60 leading-snug line-clamp-2"
                >
                  {post.excerpt}
                </p>
                <span className="mt-3 inline-flex items-center gap-1.5 font-sans text-sm font-medium text-indian-red">
                  {t(locale, 'Read more')}
                  <span aria-hidden="true" className="group-hover:translate-x-1 transition-transform">
                    &rarr;
                  </span>
                </span>
              </div>
            </a>
          ))}
          <div className="shrink-0 w-6 lg:w-10" aria-hidden="true" />
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <a
          href={viewAll.href}
          data-cms-link="blogTeaser.viewAll.href"
          className="lg:hidden mt-10 inline-flex items-center gap-2 px-6 py-3 rounded-full border border-indian-red/25 text-indian-red font-sans text-sm font-medium"
        >
          <span data-cms-field="blogTeaser.viewAll.label">{viewAll.label}</span>
          <span aria-hidden="true">&rarr;</span>
        </a>
      </div>
    </section>
  );
}
