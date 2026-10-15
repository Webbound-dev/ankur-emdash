import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger, useGSAP);

export interface Product {
  name: string;
  tag: string;
  tagline: string;
  image: { src: string; alt: string };
  href: string;
}

export interface ProductsTeaserContent {
  eyebrow: string;
  title: string;
  viewAll: { label: string; href: string };
  products: Product[];
}

export default function ProductsTeaser({ content }: { content: ProductsTeaserContent }) {
  const { eyebrow, title, viewAll, products } = content;
  const sectionRef = useRef<HTMLElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeProduct = activeIndex !== null ? products[activeIndex] : null;

  // Escape-to-close and scroll lock while the modal is open.
  useEffect(() => {
    if (activeIndex === null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveIndex(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [activeIndex]);

  useGSAP(
    () => {
      if (!modalRef.current) return;
      gsap.fromTo(modalRef.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' });
      gsap.fromTo(
        '.product-modal-panel',
        { opacity: 0, y: 24, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'power3.out', delay: 0.05 },
      );
    },
    { dependencies: [activeIndex], scope: sectionRef },
  );

  // pre-anim-hidden (the global rules in global.css, not a scoped <style>
  // here — this site uses Astro's <ClientRouter />, and a per-page
  // stylesheet isn't guaranteed loaded at the instant a page's HTML gets
  // swapped in during a soft navigation) hides the rule, heading, and cards
  // via plain CSS from the very first paint — Astro renders and paints the
  // real, fully-visible copy well before this client:visible island
  // hydrates, so without it there's a real gap where the finished section
  // sits on screen unanimated before GSAP catches up and yanks it back to
  // hidden. fromTo (not .from) gives each tween an
  // explicit end value instead of letting GSAP infer one by reading the
  // element's current computed style — which, with the CSS above already
  // at opacity:0, would otherwise read "current == target == 0" and produce
  // a no-op. No clearProps: none of these elements have another rule
  // fighting for opacity/transform/filter, so GSAP's final inline values
  // are safe to leave in place permanently.
  useGSAP(
    () => {
      // Header: eyebrow + title rise and fade. Uses ScrollTrigger.batch (not
      // a bare gsap.from + scrollTrigger config) — the latter was found to
      // get permanently stuck mid-tween on pages with async image loads
      // shifting layout after the trigger fires.
      ScrollTrigger.batch('.pt-heading > *', {
        start: 'top 75%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { y: 24, opacity: 0, filter: 'blur(10px)' },
            { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'power3.out', stagger: 0.1, delay: 0.15 },
          ),
      });

      // Cards: staggered rise + fade + subtle scale-in as the grid enters
      // view — batched so it fires once per card the moment it crosses the
      // threshold, not a single all-at-once reveal.
      ScrollTrigger.batch('.product-card', {
        start: 'top 85%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { y: 56, opacity: 0, scale: 0.94 },
            { y: 0, opacity: 1, scale: 1, duration: 0.8, ease: 'power3.out', stagger: 0.12 },
          ),
      });
    },
    { scope: sectionRef },
  );

  return (
    <section ref={sectionRef} className="pre-anim-hidden relative bg-indian-red border-t border-silent-white/10 py-20 lg:py-28 overflow-hidden">
      {/* Same faint vertical-line texture as Factory Video / the footer's
          CTA band — Hero right above this section is also dark, so the
          border above plus this texture keep the seam between them
          legible instead of the two just merging into one red block. */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: 'repeating-linear-gradient(90deg, #FFF6EB 0, #FFF6EB 1px, transparent 1px, transparent 28px)',
        }}
        aria-hidden="true"
      />

      <div className="relative max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-12 lg:mb-16">
          <div className="pt-heading">
            <div className="mb-4">
              <span
                data-cms-field="productsTeaser.eyebrow"
                className="font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-silent-white/70"
              >
                {eyebrow}
              </span>
            </div>
            <h2
              data-cms-field="productsTeaser.title"
              className="font-display font-medium text-silent-white text-3xl sm:text-4xl lg:text-5xl leading-[1.1]"
            >
              {title}
            </h2>
          </div>

          <a
            href={viewAll.href}
            data-cms-link="productsTeaser.viewAll.href"
            className="hidden lg:inline-flex items-center gap-2 px-6 py-3 rounded-full border border-silent-white/25 text-silent-white font-sans text-sm font-medium hover:bg-silent-white hover:text-indian-red hover:border-silent-white transition-colors shrink-0"
          >
            <span data-cms-field="productsTeaser.viewAll.label">{viewAll.label}</span>
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 lg:gap-x-10 gap-y-14 lg:gap-y-20">
          {products.map((product, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIndex(i)}
              // No border/card chrome around the photo — the image is the
              // whole card, borderless and confident, with color used only
              // where it's earning its keep (the tag, the CTA, the hover
              // underline), not as decoration around every edge.
              className="product-card group block w-full text-left"
            >
              {/* Real color photography, not desaturated — but every image
                  carries the same permanent brand-tint wash (multiply blend),
                  so unrelated stock shots with different lighting and color
                  casts still read as one deliberate, branded system instead
                  of a random stock-photo grab bag. */}
              <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-silent-white/10 shadow-md group-hover:shadow-2xl transition-shadow duration-300">
                <img
                  src={product.image.src}
                  alt={product.image.alt}
                  data-cms-image={`productsTeaser.products[${i}].image.src`}
                  width={1254}
                  height={1254}
                  className="w-full h-full object-cover group-hover:scale-[1.05] transition-transform duration-700 ease-out"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-indian-red/25 via-transparent to-indian-red/5 mix-blend-multiply" />
              </div>

              {/* Tight, single-column, left-aligned stack — tag, name,
                  tagline sit directly on top of each other with no
                  competing side elements, so it reads as one continuous
                  block flowing straight out of the image above it. Tag is
                  small, precise uppercase text — color used as a signal,
                  not a loud block. */}
              <div className="mt-5 transition-transform duration-300 group-hover:-translate-y-1">
                <span
                  data-cms-field={`productsTeaser.products[${i}].tag`}
                  className="block font-sans text-[11px] font-bold uppercase tracking-[0.25em] text-silent-white/70 mb-1.5"
                >
                  {product.tag}
                </span>
                <h3
                  data-cms-field={`productsTeaser.products[${i}].name`}
                  className="inline font-display font-medium text-silent-white text-2xl lg:text-[1.75rem] leading-tight bg-[linear-gradient(currentColor,currentColor)] bg-no-repeat bg-[length:0%_1.5px] group-hover:bg-[length:100%_1.5px] bg-[position:0_100%] transition-[background-size] duration-300"
                >
                  {product.name}
                </h3>
                <p
                  data-cms-field={`productsTeaser.products[${i}].tagline`}
                  className="mt-2 font-sans text-sm text-silent-white/60 leading-snug"
                >
                  {product.tagline}
                </p>
              </div>
            </button>
          ))}
        </div>

        <a
          href={viewAll.href}
          data-cms-link="productsTeaser.viewAll.href"
          className="lg:hidden mt-10 inline-flex items-center gap-2 px-6 py-3 rounded-full border border-silent-white/25 text-silent-white font-sans text-sm font-medium"
        >
          <span data-cms-field="productsTeaser.viewAll.label">{viewAll.label}</span>
          <span aria-hidden="true">&rarr;</span>
        </a>
      </div>

      {/* Detail modal — read-only preview of whichever card was clicked;
          all the editable fields live on the grid cards above, this just
          displays the same content bigger. The "View full details" link is
          the only new piece of UI here, so it's the one CMS-editable link. */}
      {activeProduct && (
        <div
          ref={modalRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-8 bg-indian-red/40 backdrop-blur-sm"
          onClick={() => setActiveIndex(null)}
        >
          <div
            className="product-modal-panel relative bg-silent-white rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setActiveIndex(null)}
              aria-label="Close"
              className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-silent-white/90 backdrop-blur-sm flex items-center justify-center text-indian-red hover:bg-indian-red hover:text-silent-white transition-colors"
            >
              &times;
            </button>

            <div className="relative aspect-[16/10] overflow-hidden">
              <img src={activeProduct.image.src} alt={activeProduct.image.alt} width={1254} height={1254} className="w-full h-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-indian-red/35 via-transparent to-indian-red/10 mix-blend-multiply" />
            </div>

            <div className="p-6 lg:p-8">
              <span className="block font-sans text-[11px] font-bold uppercase tracking-[0.25em] text-indian-red mb-2">
                {activeProduct.tag}
              </span>
              <h3 className="font-display font-medium text-indian-red text-2xl lg:text-3xl leading-tight">
                {activeProduct.name}
              </h3>
              <p className="mt-3 font-sans text-sm lg:text-base text-indian-red/70 leading-relaxed">
                {activeProduct.tagline}
              </p>
              <a
                href={activeProduct.href}
                data-cms-link={`productsTeaser.products[${activeIndex}].href`}
                className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-indian-red text-silent-white font-sans text-sm font-medium hover:opacity-90 transition-opacity"
              >
                View full details
                <span aria-hidden="true">&rarr;</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
