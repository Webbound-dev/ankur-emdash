import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import indiaMapRaw from '@svg-maps/india';
import { computePathCentroid } from '../lib/mapCentroid';

// Browser only: GSAP starts a timer on registration, which Cloudflare Workers forbid at module scope (SSR).
if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

interface IndiaLocation {
  name: string;
  id: string;
  path: string;
}

// Real state/UT boundaries (CC-BY-4.0, github.com/VictorCazanave/svg-maps) —
// not a hand-drawn approximation, so every path lines up with an actual
// place name an editor can type.
const indiaMap = indiaMapRaw as unknown as { viewBox: string; locations: IndiaLocation[] };
const [, , VIEWBOX_W, VIEWBOX_H] = indiaMap.viewBox.split(' ').map(Number);

const LOCATION_BY_KEY = new Map<string, IndiaLocation>();
for (const loc of indiaMap.locations) {
  LOCATION_BY_KEY.set(loc.name.trim().toLowerCase(), loc);
  LOCATION_BY_KEY.set(loc.id.trim().toLowerCase(), loc);
}

/** Matches a free-text CMS entry ("Gujarat", "GJ") to a real state/UT path. */
function findLocation(name: string): IndiaLocation | undefined {
  return LOCATION_BY_KEY.get(name.trim().toLowerCase());
}

export interface DistributionState {
  name: string;
}

export interface DistributionMapContent {
  eyebrow: string;
  title: string;
  viewAll: { label: string; href: string };
  states: DistributionState[];
}

export default function DistributionMap({
  content,
  distributors,
}: {
  content: DistributionMapContent;
  // Optional: the full distributor directory (same data /network's map
  // uses). When present, it drives which states get a pin/highlight on the
  // map itself — the curated `states` legend below stays editorial (a
  // handful of headline numbers), no longer the thing the map is limited
  // to. Falls back to the legend states for pin placement if omitted.
  distributors?: { state: string }[];
}) {
  const { eyebrow, title, viewAll } = content;
  const sectionRef = useRef<HTMLElement>(null);
  const pathRefs = useRef<Map<string, SVGPathElement>>(new Map());

  const states = content.states;
  const [centers, setCenters] = useState<Map<string, { x: number; y: number }>>(new Map());

  // Pin positions come from each path's actual filled-area centroid, not
  // guessed coordinates and not a bounding-box center — bbox centers drift
  // badly for concave/elongated states (Gujarat's Kutch peninsula, J&K's
  // long diagonal shape), landing markers near a border instead of on the
  // state. This is still fully automatic: adding an arbitrary state name
  // from the CMS "just works" without anyone hand-plotting a coordinate.
  useLayoutEffect(() => {
    const next = new Map<string, { x: number; y: number }>();
    pathRefs.current.forEach((el, id) => {
      const centroid = computePathCentroid(el.getAttribute('d') ?? '', VIEWBOX_W, VIEWBOX_H);
      if (centroid) next.set(id, centroid);
    });
    setCenters(next);
  }, []);

  // Plain useLayoutEffect + gsap.context (not useGSAP) — matches the fix
  // already adopted in CertificationsStrip: this page mounts several
  // client:visible islands, and having more than one of them call the
  // useGSAP hook broke React's hook dispatch. gsap.context() gives the same
  // scoped auto-cleanup without touching the hook. useLayoutEffect (not
  // useEffect) applies the hidden starting state before first paint — though
  // on its own that's not sufficient, since Astro paints the real,
  // fully-visible copy well before this client:visible island hydrates. The
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
      ScrollTrigger.batch('.dm-heading > *', {
        start: 'top 80%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { y: 24, opacity: 0, filter: 'blur(10px)' },
            { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'power3.out', stagger: 0.1, delay: 0.15 },
          ),
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  // Pins get their own effect, keyed on `centers` — they don't exist in the
  // DOM at all until the centers-computing layout effect above resolves and
  // triggers a second render (each pin's own JSX bails to `null` while its
  // center is still unknown). Registering ScrollTrigger.batch('.dm-pin', ...)
  // in the same, mount-only effect as the rule/heading above was finding
  // zero elements — batch() reads the DOM once, synchronously, at
  // registration time, it doesn't watch for elements added later — so the
  // pins silently never animated (and any layout-effect setState racing
  // ahead of it made this the reliable outcome, not an edge case). This
  // effect re-registers once real pins are actually in the DOM.
  useLayoutEffect(() => {
    if (centers.size === 0) return;
    const ctx = gsap.context(() => {
      ScrollTrigger.batch('.dm-pin', {
        start: 'top 80%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { scale: 0, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)', stagger: 0.08 },
          ),
      });
    }, sectionRef);
    return () => ctx.revert();
  }, [centers]);

  // Map coverage comes from the full distributor list when it's passed in
  // (every state/UT with at least one distributor), not just the curated
  // legend — otherwise the map visually understates "nationwide" down to
  // whichever handful of states happen to be featured in the legend copy.
  const mapStateNames =
    distributors && distributors.length > 0
      ? [...new Set(distributors.map((d) => d.state).filter(Boolean))]
      : states.map((s) => s.name);

  return (
    <section ref={sectionRef} className="pre-anim-hidden bg-silent-white border-t border-indian-red/10 py-20 lg:py-28 overflow-hidden">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        {/* Copy column */}
        <div className="dm-heading">
          <div className="mb-4">
            <span
              data-cms-field="distributionMap.eyebrow"
              className="font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-indian-red/70"
            >
              {eyebrow}
            </span>
          </div>
          <h2
            data-cms-field="distributionMap.title"
            className="font-display font-medium text-indian-red text-3xl sm:text-4xl lg:text-5xl leading-[1.1] mb-6 [text-wrap:balance]"
          >
            {title}
          </h2>
          <a
            href={viewAll.href}
            data-cms-link="distributionMap.viewAll.href"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-indian-red/25 text-indian-red font-sans text-sm font-medium hover:bg-indian-red hover:text-silent-white hover:border-indian-red transition-colors"
          >
            <span data-cms-field="distributionMap.viewAll.label">{viewAll.label}</span>
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>

        {/* Map card */}
        <div className="relative bg-indian-red/[0.04] border border-indian-red/10 rounded-2xl p-6 lg:p-10 shadow-sm">
          <span className="sr-only">Map of Ankur's distribution across India</span>
          <div className="relative w-full max-w-[320px] mx-auto">
            <svg viewBox={indiaMap.viewBox} className="w-full h-auto" aria-hidden="true">
              {/* One flat fill for every state — with coverage now spanning
                  nearly the whole country, shading "highlighted" states
                  darker just washed the entire landmass red. The presence
                  dots alone carry the "we're here" signal now. */}
              {indiaMap.locations.map((loc) => (
                <path
                  key={loc.id}
                  ref={(el) => {
                    if (el) pathRefs.current.set(loc.id, el);
                  }}
                  d={loc.path}
                  fill="currentColor"
                  stroke="#FFF6EB"
                  strokeWidth={0.75}
                  className="text-indian-red/10"
                />
              ))}
              {mapStateNames.map((name) => {
                const loc = findLocation(name);
                const center = loc && centers.get(loc.id);
                if (!center) return null;
                // Presence dot — just marks that Ankur has a footprint in
                // this state, no distributor count anywhere on it. The halo
                // ring is what gives a plain dot enough presence to read as
                // a deliberate marker rather than a stray mark on the map.
                return (
                  <g key={name} className="dm-pin" transform={`translate(${center.x}, ${center.y})`}>
                    <title>{name}</title>
                    <circle r={11} fill="none" stroke="#A82121" strokeOpacity={0.35} strokeWidth={1.5} />
                    <circle r={5} fill="#A82121" />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
