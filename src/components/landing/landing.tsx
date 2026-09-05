"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import "./landing.css";

/* ---------- helpers ---------- */

function useInView<T extends HTMLElement>(threshold = 0.25) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }),
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, seen };
}

function Reveal({ children, style, delay }: { children: React.ReactNode; style?: React.CSSProperties; delay?: number }) {
  const { ref, seen } = useInView<HTMLDivElement>(0.15);
  return (
    <div ref={ref} className={`lp-reveal${seen ? " is-in" : ""}`} style={delay ? { ...style, transitionDelay: `${delay}ms` } : style}>
      {children}
    </div>
  );
}

function ProductTour() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      video.pause();
      video.currentTime = 0;
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => undefined);
      else video.pause();
    }, { threshold: 0.2 });

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={videoRef}
      className="lp-tour-video"
      muted
      loop
      playsInline
      preload="metadata"
      poster="/demo/returnsplit-product-tour-poster.webp?v=no-motion-1"
      aria-label="A short tour of the ReturnSplit claims queue, claim review, orders, policies, reserve forecast, evaluation, and activity views"
    >
      <source src="/demo/returnsplit-product-tour.mp4?v=no-motion-1" type="video/mp4" />
    </video>
  );
}

function FeatureClip({ src, poster, label }: { src: string; poster: string; label: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      video.pause();
      video.currentTime = 0;
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => undefined);
      else video.pause();
    }, { threshold: 0.25 });

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={videoRef}
      className="lp-feature-video"
      muted
      loop
      playsInline
      preload="metadata"
      poster={poster}
      aria-label={label}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}

/* ---------- icons ---------- */
const I = {
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>,
  arrow: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
};

const OPERATOR_SIGNALS = [
  {
    quote: "In multi-store orders, this feels inconsistent and harder to reconcile: reporting, refund logic, disputes, accounting clarity.",
    source: "multi-store payments",
    href: "https://www.reddit.com/r/stripe/comments/1qwuwbe/stripe_connect_fee_handling_destination_charges/",
  },
  {
    quote: "Whenever I refund a charge, the refund is actually getting taken from the business account instead of the connected account.",
    source: "connected-account refunds",
    href: "https://www.reddit.com/r/stripe/comments/15gck8a/refund_payment_to_connected_account_taking/",
  },
  {
    quote: "With split payments, the application is liable for fees, chargebacks and refunds. I would like the vendor to be liable.",
    source: "multi-vendor marketplace",
    href: "https://www.reddit.com/r/stripe/comments/um37uu/can_i_use_stripe_connects_direct_charges_for/",
  },
];

/* ---------- FAQ ---------- */
const FAQS: { q: string; a: string }[] = [
  { q: "Does ReturnSplit ever hold my money?", a: "No. The default provider is a deterministic simulator, and the optional adapter accepts Razorpay Test Mode credentials only. ReturnSplit never pools or custodies funds; live keys are rejected." },
  { q: "How is this different from Razorpay's refund API?", a: "For a partial refund on a payment split across multiple Route transfers, Razorpay cannot decide which transfer to reverse - its own docs say so. This prototype computes the per-seller paise and demonstrates reversal-before-refund ordering in a resumable, process-local saga. Durable crash recovery remains production work." },
  { q: "What if a seller already withdrew their payout?", a: "The demo blocks approval when the reversible balance is insufficient (claim RET-260903-038 has only ₹49.15 available), exposes the residual, and can open an owned payments-reconciliation case. It does not silently continue or write off the gap." },
  { q: "Is the money math actually safe?", a: "Amounts are computed in integer paise with largest-remainder rounding. Across 64 pre-structured synthetic records, the engine matched all expected finance-control decisions with ₹0 wrong-seller overage and 0 unsafe automations. That is fixture agreement, not extraction accuracy or live-provider evidence." },
  { q: "What audit record does the prototype provide?", a: "The workbench records process-local approval, execution, and operations history and can generate a redacted audit export. It is not durable, signed, hash-chained, WORM-retained, or a compliance record; production needs an authenticated, tenant-scoped, tamper-evident store." },
  { q: "What can I try today?", a: "Open the workbench and replay seeded partial-refund scenarios through the deterministic split, human approval, simulated execution, and audit export. The fixtures are synthetic and do not ingest a live merchant return." },
];

function FaqItem({ q, a, open, onClick }: { q: string; a: string; open: boolean; onClick: () => void }) {
  return (
    <div className={`lp-qa${open ? " open" : ""}`}>
      <button className="lp-qa-q" onClick={onClick} aria-expanded={open}>
        {q}
        <span className="lp-qa-ic">{I.plus}</span>
      </button>
      <div className="lp-qa-a"><p>{a}</p></div>
    </div>
  );
}

/* ---------- page ---------- */
export function Landing() {
  const [atTop, setAtTop] = useState(true);
  const [dir, setDir] = useState<"up" | "down">("up");
  const [prog, setProg] = useState(0);
  const [openFaq, setOpenFaq] = useState(0);
  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      setAtTop(y < 8);
      if (y - last > 4) setDir("down");
      else if (last - y > 4) setDir("up");
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProg(max > 0 ? Math.min(1, y / max) : 0);
      last = y;
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const float = !atTop;
  const compact = float && dir === "down";
  // hide the window scrollbar only while the landing page is mounted
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("lp-no-scrollbar");
    return () => root.classList.remove("lp-no-scrollbar");
  }, []);

  return (
    <>
      <div className="lp-progress" style={{ transform: `scaleX(${prog})` }} aria-hidden />
      <nav className={`lp-nav${float ? " is-float" : ""}${compact ? " is-compact" : ""}`}>
        <div className="lp-nav-shell">
          <a className="lp-word" href="#top">Return<span className="s">Split</span></a>
          <div className="lp-nav-links">
            <a href="#how">How it works</a>
            <a href="#control">Control</a>
            <a href="#assurance">Assurance</a>
            <a href="#developers">Developers</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="lp-nav-cta">
            <a
              className="lp-btn lp-btn-ghost lp-nav-social lp-nav-github"
              href="https://github.com/codebanditssss/ReturnSplit-Razorpay-Buildathon"
              target="_blank"
              rel="noreferrer"
              aria-label="Open ReturnSplit on GitHub in a new tab"
            >
              <Image src="/social/github.svg" alt="" width={17} height={17} unoptimized />
              <span>GitHub</span>
            </a>
            <a
              className="lp-btn lp-btn-ghost lp-nav-social lp-nav-x"
              href="https://x.com/laziedev"
              target="_blank"
              rel="noreferrer"
              aria-label="Open Khushi's profile on X in a new tab"
            >
              <Image src="/social/x.svg" alt="" width={15} height={15} unoptimized />
            </a>
          </div>
        </div>
      </nav>

      {/* hero */}
      <header className="lp-hero" id="top">
        <div className="lp-dots" />
        <div className="lp-wrap lp-hero-inner">
          <h1>
            <span>One item comes back.</span>
            <span>Reverse the <em>exact</em> transfer.</span>
          </h1>
          <div className="lp-hero-actions">
            <Link className="lp-btn lp-btn-primary lp-btn-lg" href="/claims">Open the workbench {I.arrow}</Link>
            <Link className="lp-btn lp-btn-ghost lp-btn-lg" href="/claims/RET-260903-031">View demo claim</Link>
          </div>
        </div>
        <div className="lp-wrap">
          <div className="lp-tour-shell lp-tour-shell-hero">
            <ProductTour />
          </div>
        </div>
      </header>

      {/* public operator signals */}
      <section className="lp-section lp-signals" aria-labelledby="operator-signals-title">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-section-head">
              <span className="lp-eyebrow sq">Operator signals</span>
              <h2 id="operator-signals-title">Marketplace refund ownership is still unclear.</h2>
              <p>Public operator discussions showing the same reconciliation gap across marketplace payment rails.</p>
            </div>
          </Reveal>
          <Reveal>
            <aside className="lp-doc-source" aria-label="Official Razorpay documentation">
              <blockquote>
                For partial refunds on a payment transferred to multiple accounts, <b>Razorpay cannot determine which
                transfer to reverse partially.</b> You will have to use the transfer reversal API.
              </blockquote>
              <div className="lp-doc-cite">
                <b>Razorpay Route - official documentation.</b>
                <a href="https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer/" target="_blank" rel="noreferrer">Razorpay Route refund API</a>
              </div>
            </aside>
          </Reveal>
          <div className="lp-signal-grid">
            {OPERATOR_SIGNALS.map((signal, index) => (
              <Reveal key={signal.href} delay={index * 70}>
                <a className="lp-signal-card" href={signal.href} target="_blank" rel="noreferrer">
                  <div className="lp-reddit-head">
                    <Image src="/social/reddit.svg" alt="" width={21} height={21} unoptimized />
                    <span><b>Public thread</b><small>payment operations</small></span>
                    <i aria-hidden />
                  </div>
                  <blockquote>{signal.quote}</blockquote>
                  <div className="lp-reddit-foot">
                    <span className="lp-reddit-context">{signal.source}</span>
                    <span className="lp-signal-link">View on Reddit {I.arrow}</span>
                  </div>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* product controls */}
      <section className="lp-section lp-feature-story" id="how">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-feature-intro" id="control">
              <span className="lp-eyebrow">Inside the workbench</span>
              <h2>Three views. One controlled refund.</h2>
              <p>Focused tools for deciding what moves, preparing for what returns, and keeping the outcome reviewable.</p>
            </div>
          </Reveal>

          <div className="lp-feature-list">
            <article className="lp-feature-row">
              <div className="lp-feature-copy">
                <span className="lp-feature-index">01 · Allocation</span>
                <h3>Balance every seller to the last paisa.</h3>
                <p>Integer-paise math assigns the exact seller reversal and platform contribution before approval.</p>
                <Link className="lp-feature-link" href="/claims/RET-260903-031">Inspect the calculation {I.arrow}</Link>
              </div>
              <div className="lp-feature-media">
                <FeatureClip
                  src="/demo/returnsplit-feature-allocation.mp4?v=no-motion-1"
                  poster="/demo/returnsplit-feature-allocation-poster.webp?v=no-motion-1"
                  label="ReturnSplit exact allocation view balancing seller reversal and platform contribution"
                />
              </div>
            </article>

            <article className="lp-feature-row is-reversed">
              <div className="lp-feature-copy">
                <span className="lp-feature-index">02 · Reserve</span>
                <h3>See refund exposure before it hits the queue.</h3>
                <p>The reserve view turns expected returns into a planning signal for finance operations.</p>
                <Link className="lp-feature-link" href="/risk">Open reserve planning {I.arrow}</Link>
              </div>
              <div className="lp-feature-media">
                <FeatureClip
                  src="/demo/returnsplit-feature-reserve.mp4?v=no-motion-1"
                  poster="/demo/returnsplit-feature-reserve-poster.webp?v=no-motion-1"
                  label="ReturnSplit reserve forecast view showing upcoming refund exposure"
                />
              </div>
            </article>

            <article className="lp-feature-row" id="developers">
              <div className="lp-feature-copy" id="assurance">
                <span className="lp-feature-index">03 · Assurance</span>
                <h3>Keep the decision attached to the outcome.</h3>
                <p>Approval, provider results, and paused exceptions stay together for review and reconciliation.</p>
                <div className="lp-feature-invariant">
                  <span>Ordering rule</span>
                  <b>Reversals confirm before the customer refund starts.</b>
                </div>
              </div>
              <div className="lp-feature-media">
                <FeatureClip
                  src="/demo/returnsplit-feature-audit.mp4?v=no-motion-1"
                  poster="/demo/returnsplit-feature-audit-poster.webp?v=no-motion-1"
                  label="ReturnSplit audit and reconciliation view showing the claim decision and outcome history"
                />
              </div>
            </article>

          </div>
        </div>
      </section>

      {/* faq */}
      <section className="lp-section" id="faq">
        <div className="lp-wrap lp-faq">
          <div className="lp-faq-left">
            <span className="lp-eyebrow sq">FAQ</span>
            <h2>Questions? Answered.</h2>
            <p>Start with the <Link href="/claims/RET-260903-031">golden claim</Link>, then inspect the <Link href="/evaluation">evaluation snapshot</Link>.</p>
          </div>
          <div className="lp-faq-list">
            {FAQS.map((f, i) => (
              <FaqItem key={i} q={f.q} a={f.a} open={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? -1 : i)} />
            ))}
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-top">
            <div className="lp-footer-lead">
              <a className="lp-word lg" href="#top">Return<span className="s">Split</span></a>
              <p>A financial-control prototype for reviewable marketplace return reversals on Razorpay Route.</p>
            </div>
            <div className="lp-footer-nav">
              <span className="lp-footer-label">Track 04 finance control · working test-mode prototype</span>
              <div className="lp-footer-links" aria-label="Footer links">
                <Link href="/claims">Workbench</Link>
                <Link href="/evaluation">Evaluation</Link>
                <a href="#developers">Engine contract</a>
                <a href="https://github.com/codebanditssss/ReturnSplit-Razorpay-Buildathon" target="_blank" rel="noreferrer">GitHub</a>
                <a href="https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer/" target="_blank" rel="noreferrer">Route docs</a>
              </div>
            </div>
          </div>
          <div className="lp-footer-note">
            <span>Demo figures use a deterministic simulator; an optional Razorpay Test Mode adapter is available. Live keys are rejected, no live money moves, and ReturnSplit never holds funds.</span>
            <span>© 2026 ReturnSplit</span>
          </div>
        </div>
      </footer>
    </>
  );
}
