"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

const navItems: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/claims", label: "Claims", icon: "inbox" },
  { href: "/orders", label: "Orders", icon: "package" },
  { href: "/policies", label: "Policies", icon: "file-text" },
  { href: "/risk", label: "Reserve", icon: "shield" },
  { href: "/activity", label: "Activity", icon: "activity" },
];

export function AppShell({ children, providerMode, providerLabel }: { children: ReactNode; providerMode: "demo" | "razorpay_test"; providerLabel: string }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarCloseButtonRef = useRef<HTMLButtonElement>(null);
  const mobileBarRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const currentSection = pathname.startsWith("/claims/")
    ? "Claim review"
    : navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.label
      ?? (pathname === "/settings" ? "Settings" : "Operations");

  function closeMobileMenu(restoreFocus = true) {
    setMenuOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  function closeMobileMenuAfterNavigation() {
    if (!menuOpen) return;
    setMenuOpen(false);
    window.setTimeout(() => document.getElementById("main-content")?.focus(), 0);
  }

  useEffect(() => {
    if (!menuOpen) return;
    sidebarRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
        return;
      }
      if (event.key === "Tab" && sidebarRef.current) {
        const focusable = [...sidebarRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 960px)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      const activeElement = document.activeElement;

      if (event.matches) {
        if (activeElement instanceof HTMLElement && sidebarRef.current?.contains(activeElement)) {
          window.requestAnimationFrame(() => {
            if (mobileViewport.matches) menuButtonRef.current?.focus();
          });
        }
        return;
      }

      const focusMovedOutOfView = activeElement === sidebarCloseButtonRef.current
        || (activeElement instanceof HTMLElement && mobileBarRef.current?.contains(activeElement));
      setMenuOpen(false);
      if (focusMovedOutOfView) {
        window.requestAnimationFrame(() => {
          if (mobileViewport.matches) return;
          const currentPageLink = sidebarRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
          const sidebarHomeLink = sidebarRef.current?.querySelector<HTMLElement>(".brand");
          (currentPageLink ?? sidebarHomeLink ?? document.getElementById("main-content"))?.focus();
        });
      }
    };
    mobileViewport.addEventListener("change", handleViewportChange);
    return () => mobileViewport.removeEventListener("change", handleViewportChange);
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" inert={menuOpen}>Skip to main content</a>
      <button aria-label="Close navigation" className={`nav-scrim ${menuOpen ? "is-visible" : ""}`}
        onClick={() => closeMobileMenu()} tabIndex={-1} aria-hidden="true" />
      <aside ref={sidebarRef} id="primary-navigation" className={`sidebar ${menuOpen ? "is-open" : ""}`}
        role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen || undefined} aria-label={menuOpen ? "Primary navigation" : undefined}>
        <div className="brand-row">
          <Link className="brand" href="/claims" aria-label="ReturnSplit home">
            <span className="brand-mark"><span /><span /></span><span>ReturnSplit</span>
          </Link>
          <button ref={sidebarCloseButtonRef} className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => closeMobileMenu()}>
            <Icon name="x" />
          </button>
        </div>
        <div className="workspace-switcher" aria-label="Current workspace, Creo Market">
          <span className="workspace-avatar">C</span>
          <span className="workspace-copy"><strong>Creo Market</strong><span>Refund operations</span></span>
        </div>
        <nav aria-label="Primary navigation" className="primary-nav">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link className={`nav-link ${active ? "is-active" : ""}`} href={item.href} key={item.href} onClick={closeMobileMenuAfterNavigation} aria-current={active ? "page" : undefined}>
                <Icon name={item.icon} /><span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className="connection-dot" />
            <div><strong>{providerMode === "demo" ? "Simulation" : "Razorpay Test Mode"}</strong><span>{providerMode === "demo" ? "No live money" : `${providerLabel} · no live money`}</span></div>
          </div>
          <Link className={`nav-link ${pathname === "/settings" ? "is-active" : ""}`} href="/settings" onClick={closeMobileMenuAfterNavigation} aria-current={pathname === "/settings" ? "page" : undefined}>
            <Icon name="settings" /><span>Settings</span>
          </Link>
          <div className="user-row">
            <span className="user-avatar">
              <Image className="profile-photo" src="/khushi-diwan-avatar.webp" alt="" width={40} height={40} />
            </span>
            <div><strong>Khushi Diwan</strong><span>Refund operations</span></div>
          </div>
        </div>
      </aside>
      <div className="dashboard-frame">
        <div ref={mobileBarRef} className="mobile-bar" inert={menuOpen}>
          <button ref={menuButtonRef} className="icon-button" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
          <Link className="brand" href="/claims"><span className="brand-mark"><span /><span /></span><span>ReturnSplit</span></Link>
          <span className="mobile-avatar">
            <Image className="profile-photo" src="/khushi-diwan-avatar.webp" alt="Khushi Diwan" width={32} height={32} priority />
          </span>
        </div>
        <header className="dashboard-topbar" inert={menuOpen}>
          <div className="dashboard-context" aria-label={`Creo Market, ${currentSection}`}>
            <span>Creo Market</span><span aria-hidden="true">/</span><strong>{currentSection}</strong>
          </div>
          <form className="dashboard-search" action="/claims" method="get" role="search">
            <Icon name="search" />
            <label className="sr-only" htmlFor="dashboard-search">Search claims</label>
            <input id="dashboard-search" name="q" type="search" placeholder="Search claims, orders, customers" autoComplete="off" />
            <button className="sr-only" type="submit">Search claims</button>
          </form>
          <div className="topbar-environment" title="This workspace cannot move live money">
            <span className="connection-dot" />
            <span>{providerMode === "demo" ? "Guided demo" : providerLabel}</span>
          </div>
        </header>
        <main className="main-content" id="main-content" tabIndex={-1} inert={menuOpen}>{children}</main>
      </div>
    </div>
  );
}
