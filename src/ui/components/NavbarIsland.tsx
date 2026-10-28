import { useEffect, useState } from 'react';
import { ChevronDown, Globe, Menu, X } from 'lucide-react';
import MenuLabel from './MenuLabel';
import { t } from '../../lib/ui-strings';
import type { Locale } from '../../lib/i18n';

interface NavLink { label: string; href: string; target?: string; titleAttr?: string; menuRef?: string }
interface ProductItem { title: string; href: string; target?: string; titleAttr?: string; menuRef?: string; variant?: 'callout' }

export interface NavbarContent {
  logo: { src: string; alt: string };
  leftLinks: NavLink[];
  rightLinks: NavLink[];
  /** Shown in a hover mega-menu under the "Products" nav link (desktop) or an
   *  expandable section in the sidebar (mobile). Entries with variant:
   *  'callout' (e.g. Industrial Salt) render as a visually distinct
   *  cross-sell row instead of a plain SKU link. */
  products: ProductItem[];
}

// Each language named in itself, in the language toggle.
const LOCALE_SHORT: Record<Locale, string> = { en: 'EN', hi: 'हिं' };
const LOCALES: Locale[] = ['en', 'hi'];

/**
 * Both languages side by side as a sliding switch: a red thumb sits under the
 * current one; clicking the other slides it across while that page loads.
 */
function LanguageToggle({ locale, alternateHref, className = '' }: { locale: Locale; alternateHref: string; className?: string }) {
  const [switching, setSwitching] = useState(false);
  const shown: Locale = switching ? (locale === 'en' ? 'hi' : 'en') : locale;
  return (
    <div role="group" aria-label={t(locale, 'Language')} className={`items-center gap-2 ${className}`}>
      <Globe size={16} strokeWidth={1.75} aria-hidden="true" className="text-indian-red/60" />
      <div className="relative grid grid-cols-2 rounded-full bg-indian-red/[0.06] p-[3px] ring-1 ring-inset ring-indian-red/15 shadow-[inset_0_1px_2px_rgba(168,33,33,0.08)]">
        <span
          aria-hidden="true"
          className={`absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-full bg-indian-red shadow-[0_2px_6px_rgba(168,33,33,0.35)] transition-transform duration-300 ease-[cubic-bezier(.4,0,.2,1)] ${shown === 'hi' ? 'translate-x-full' : 'translate-x-0'}`}
        />
        {LOCALES.map((l) => {
          const label = (
            <span className={`relative z-10 flex h-7 w-11 items-center justify-center font-sans text-[13px] font-semibold leading-none transition-colors duration-300 ${shown === l ? 'text-silent-white' : 'text-indian-red/60 group-hover:text-indian-red'}`}>
              {LOCALE_SHORT[l]}
            </span>
          );
          return l === locale ? (
            <span key={l} lang={l} aria-current="true" className="rounded-full">{label}</span>
          ) : (
            <a
              key={l}
              href={alternateHref}
              hrefLang={l}
              lang={l}
              onClick={() => setSwitching(true)}
              aria-label={t(locale, l === 'hi' ? 'Switch to Hindi' : 'Switch to English')}
              className="group rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indian-red/40"
            >
              {label}
            </a>
          );
        })}
      </div>
    </div>
  );
}

interface NavbarProps {
  pathname: string;
  content: NavbarContent;
  /** Current site locale, and the equivalent page's href in the other
   *  locale — both provided by BaseLayout so this component doesn't need to
   *  know about routing/i18n config itself. Optional so existing callers
   *  (and Storybook-style isolated renders) don't have to pass them. */
  locale?: Locale;
  alternateLocale?: Locale;
  alternateHref?: string;
}

export default function NavbarIsland({ pathname, content, locale, alternateLocale, alternateHref }: NavbarProps) {
  const { logo, leftLinks, rightLinks, products } = content;
  const [scrolled, setScrolled] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileProductsOpen, setMobileProductsOpen] = useState(false);
  const allLinks = [...leftLinks, ...rightLinks];

  // Subtle shadow once the page scrolls, so the sticky header lifts off the content.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock background scroll while the sidebar is open, and let Escape close it.
  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [sidebarOpen]);

  // Menu URLs end with a slash ("/products/") and, on Hindi pages, start
  // with the language ("/hi/products/"); compare without either.
  const withoutSlash = (href: string) => href.replace(/^\/hi(?=\/|$)/, '').replace(/\/+$/, '') || '/';
  const isProductsLink = (href: string) => withoutSlash(href) === '/products';

  const isActive = (href: string) => pathname === href || (withoutSlash(href) !== '/' && pathname.startsWith(href));

  // Consumer Salt and Industrial Salt are the two core product lines, so
  // they get a touch more visual weight than the rest of the nav — semibold
  // and never dimmed, instead of the resting 80% opacity every other link gets.
  const isHighlighted = (href: string) => isProductsLink(href) || withoutSlash(href) === '/industrial-salt';

  // Bolder weight + an underline that grows in from the left on hover
  // (stays fully drawn for the current page).
  const linkClass = (href: string) =>
    `relative inline-block w-fit pb-1 transition-all duration-200 after:content-[''] after:absolute after:left-0 after:-bottom-0.5 after:h-[2px] after:bg-indian-red after:transition-all after:duration-300 after:ease-out ${
      isHighlighted(href) ? 'font-semibold drop-shadow-sm' : 'font-medium'
    } ${
      isActive(href)
        ? 'after:w-full'
        : `after:w-0 hover:after:w-full ${isHighlighted(href) ? 'opacity-100' : 'opacity-90 hover:opacity-100'}`
    }`;

  return (
    <header
      className={`sticky top-0 z-50 bg-silent-white text-indian-red transition-shadow duration-300 ${
        scrolled ? 'shadow-md shadow-indian-red/5 border-b border-transparent' : 'border-b border-indian-red/10'
      }`}
    >
      <nav className="max-w-[1400px] mx-auto px-4 lg:px-6 h-20 lg:h-24 flex items-center justify-between lg:justify-center gap-4 lg:gap-10">
        {/* Mobile hamburger */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden p-1.5 -ml-1.5 shrink-0"
          aria-label={t(locale ?? 'en', 'Open menu')}
        >
          <Menu size={22} />
        </button>

        {/* Left nav links — desktop only. The whole [links, logo, links]
            trio is centered as one group (nav's justify-center) so it sits
            in the middle of the header regardless of how the two sides'
            content widths differ — matches the logo-in-the-middle
            reference navbar rather than forcing the logo to be the exact
            pixel midpoint. On mobile these are display:none, so they drop
            out of the flex row entirely (see logo/spacer below). */}
        <div className="hidden lg:flex items-center gap-x-10 gap-y-2 font-sans text-sm">
          {leftLinks.map((link) => {
            if (isProductsLink(link.href)) {
              return (
                <div
                  key={link.href}
                  className="relative"
                  onMouseEnter={() => setProductsOpen(true)}
                  onMouseLeave={() => setProductsOpen(false)}
                >
                  <a
                    href={link.href}
                    target={link.target}
                    rel={link.target === "_blank" ? "noopener noreferrer" : undefined}
                    title={link.titleAttr}
                    data-cms-menu-link={link.menuRef}
                    className={`${linkClass(link.href)} inline-flex items-center gap-1`}
                  >
                    <MenuLabel menuRef={link.menuRef}>{link.label}</MenuLabel>
                    <ChevronDown
                      size={14}
                      className={`transition-transform duration-200 ${productsOpen ? 'rotate-180' : ''}`}
                    />
                  </a>

                  {/* Dropdown */}
                  <div
                    className={`absolute left-0 top-full z-50 pt-3 origin-top transition-all duration-200 ease-out ${
                      productsOpen ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' : 'opacity-0 -translate-y-1 scale-95 pointer-events-none'
                    }`}
                  >
                    <div className="min-w-[250px] overflow-hidden rounded-xl bg-white border border-indian-red/10 shadow-lg shadow-black/[0.08]">
                      <div className="px-4 pt-3.5 pb-2">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-indian-red/40">
                          {t(locale ?? 'en', 'Our Products')}
                        </span>
                      </div>

                      <div className="p-2 pt-0">
                        {products.map((product) =>
                          product.variant === 'callout' ? (
                            <a
                              key={product.href}
                              href={product.href}
                              target={product.target}
                              rel={product.target === "_blank" ? "noopener noreferrer" : undefined}
                              title={product.titleAttr}
                              data-cms-menu-link={product.menuRef}
                              className="group relative mt-1 flex items-center gap-2.5 rounded-xl border-t border-indian-red/10 px-3 pt-3.5 pb-2.5 text-sm font-semibold text-indian-red transition-colors duration-150 hover:bg-indian-red/[0.06]"
                            >
                              <MenuLabel menuRef={product.menuRef}>{product.title}</MenuLabel>
                              <span aria-hidden="true" className="ml-auto transition-transform duration-150 group-hover:translate-x-0.5">&rarr;</span>
                            </a>
                          ) : (
                            <a
                              key={product.href}
                              href={product.href}
                              target={product.target}
                              rel={product.target === "_blank" ? "noopener noreferrer" : undefined}
                              title={product.titleAttr}
                              data-cms-menu-link={product.menuRef}
                              className="group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-indian-red/80 transition-colors duration-150 hover:bg-indian-red/[0.06] hover:text-indian-red"
                            >
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indian-red/50 transition-colors duration-150 group-hover:bg-indian-red" />
                              <MenuLabel menuRef={product.menuRef}>{product.title}</MenuLabel>
                            </a>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <a
                key={link.href}
                href={link.href}
                target={link.target}
                rel={link.target === "_blank" ? "noopener noreferrer" : undefined}
                title={link.titleAttr}
                data-cms-menu-link={link.menuRef}
                className={linkClass(link.href)}
              >
                <MenuLabel menuRef={link.menuRef}>{link.label}</MenuLabel>
              </a>
            );
          })}
        </div>

        {/* Logo — sits between the two link groups in the centered cluster
            on desktop. On mobile, leftLinks/rightLinks are display:none so
            this sits between the hamburger and the spacer below, centered
            by justify-between with those two equal-width elements. */}
        <a
          href={locale === 'hi' ? '/hi/' : '/'}
          className="flex items-center shrink-0 px-2 lg:px-6 transition-transform duration-200 hover:scale-105"
          data-cms-image="logo.src"
        >
          <img src={logo.src} alt={logo.alt} width={10558} height={5263} className="h-9 lg:h-10 w-auto" />
        </a>

        {/* Right nav links — desktop only, part of the same centered
            cluster as leftLinks/logo. Omitted entirely (not just visually
            hidden) when empty. */}
        {rightLinks.length > 0 && (
          <div className="hidden lg:flex items-center gap-x-10 gap-y-2 font-sans text-sm">
            {rightLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target={link.target}
                rel={link.target === "_blank" ? "noopener noreferrer" : undefined}
                title={link.titleAttr}
                data-cms-menu-link={link.menuRef}
                className={linkClass(link.href)}
              >
                <MenuLabel menuRef={link.menuRef}>{link.label}</MenuLabel>
              </a>
            ))}
          </div>
        )}

        {/* Language switcher — desktop only, links to the equivalent page
            in the other locale (computed by BaseLayout via astro:i18n so
            this component stays routing-agnostic). Hidden until both props
            are supplied. */}
        {locale && alternateLocale && alternateHref && (
          <LanguageToggle locale={locale} alternateHref={alternateHref} className="hidden lg:inline-flex shrink-0" />
        )}

        {/* Mobile spacer — balances the hamburger's width so the logo stays centered */}
        <div className="lg:hidden w-[22px] shrink-0" aria-hidden="true" />
      </nav>

      {/* Mobile sidebar backdrop */}
      <div
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Mobile sidebar panel */}
      <div
        className={`nav-sidebar-scroll fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] bg-silent-white text-indian-red shadow-2xl overflow-y-auto transition-transform duration-300 ease-out lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-indian-red/15">
          <img src={logo.src} alt={logo.alt} width={10558} height={5263} className="h-8 w-auto" />
          <div className="flex items-center gap-3">
            {locale && alternateLocale && alternateHref && (
              <LanguageToggle locale={locale} alternateHref={alternateHref} className="inline-flex" />
            )}
            <button onClick={() => setSidebarOpen(false)} aria-label={t(locale ?? 'en', 'Close menu')} className="p-1">
              <X size={22} />
            </button>
          </div>
        </div>

        <nav className="px-4 py-4 font-sans text-sm flex flex-col gap-1">
          {allLinks.map((link) => {

            if (isProductsLink(link.href)) {
              return (
                <div key={link.href}>
                  <button
                    onClick={() => setMobileProductsOpen((o) => !o)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-3 text-left font-medium"
                  >
                    <span><MenuLabel menuRef={link.menuRef}>{link.label}</MenuLabel></span>
                    <ChevronDown
                      size={16}
                      className={`transition-transform duration-200 ${mobileProductsOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-out ${
                      mobileProductsOpen ? 'max-h-[600px]' : 'max-h-0'
                    }`}
                  >
                    <div className="pl-3 pb-2 flex flex-col gap-1">
                      {products.map((product) =>
                        product.variant === 'callout' ? (
                          <a
                            key={product.href}
                            href={product.href}
                            target={product.target}
                            rel={product.target === "_blank" ? "noopener noreferrer" : undefined}
                            title={product.titleAttr}
                            data-cms-menu-link={product.menuRef}

                            onClick={() => setSidebarOpen(false)}
                            className="mt-1 flex items-center gap-2.5 rounded-lg border-t border-indian-red/10 px-3 pt-3 pb-2 font-semibold text-indian-red"
                          >
                            <span className="min-w-0 flex-1"><MenuLabel menuRef={product.menuRef}>{product.title}</MenuLabel></span>
                            <span aria-hidden="true">&rarr;</span>
                          </a>
                        ) : (
                          <a
                            key={product.href}
                            href={product.href}
                            target={product.target}
                            rel={product.target === "_blank" ? "noopener noreferrer" : undefined}
                            title={product.titleAttr}
                            data-cms-menu-link={product.menuRef}

                            onClick={() => setSidebarOpen(false)}
                            className="flex items-start gap-2.5 rounded-lg px-3 py-2 text-indian-red/75"
                          >
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indian-red/50" />
                            <span className="min-w-0 flex-1"><MenuLabel menuRef={product.menuRef}>{product.title}</MenuLabel></span>
                          </a>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <a
                key={link.href}
                href={link.href}
                target={link.target}
                rel={link.target === "_blank" ? "noopener noreferrer" : undefined}
                title={link.titleAttr}
                data-cms-menu-link={link.menuRef}

                onClick={() => setSidebarOpen(false)}
                className={`rounded-lg px-3 py-3 ${isHighlighted(link.href) ? 'font-semibold' : 'font-medium'} ${isActive(link.href) ? 'text-indian-red' : 'text-indian-red/80'}`}
              >
                <MenuLabel menuRef={link.menuRef}>{link.label}</MenuLabel>
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
