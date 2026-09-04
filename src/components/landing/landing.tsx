"use client";

import { useEffect, useRef, useState } from "react";
import "./landing.css";

/* ---------- helpers ---------- */

function rupees(paise: number): string {
  return "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function useCountUp(target: number, run: boolean, ms = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

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

/* subtle pointer-driven 3D tilt (desktop + motion-ok only) */
function useTilt<T extends HTMLElement>(strength = 3.2) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--ry", `${px * strength}deg`);
        el.style.setProperty("--rx", `${-py * strength}deg`);
      });
    };
    const reset = () => { el.style.setProperty("--ry", "0deg"); el.style.setProperty("--rx", "0deg"); };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", reset);
    return () => { el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", reset); cancelAnimationFrame(raf); };
  }, [strength]);
  return ref;
}

/* ---------- icons ---------- */
const I = {
  arrowLeft: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>,
  minus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg>,
  calc: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M8 18h4" /></svg>,
  refresh: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></svg>,
  scroll: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9M8 3h10a2 2 0 0 1 2 2v3M8 3v14a2 2 0 0 0 2 2h1M8 7h6M8 11h4" /></svg>,
  trend: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8M15 7h6v6" /></svg>,
  layers: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5" /></svg>,
  lock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  arrow: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  inbox: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.5Z" /></svg>,
  pkg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8" /></svg>,
  file: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M9 13h6M9 17h6" /></svg>,
  activity: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
};

/* ---------- real golden-case data (order MM-18472 / claim RET-260903-031) ---------- */
const CUSTOMER = 232854;  // ₹2,328.54 customer refund
const AAVYA = 197926;     // ₹1,979.26 reversed from Aavya Textiles
const MARKET = 34928;     // ₹349.28 marketplace contribution

/* code sample rendered from tokens so no literal braces sit in JSX text */
type Tok = { t: string; c?: string };
const CODE: Tok[][] = [
  [{ t: "const", c: "k" }, { t: " plan " }, { t: "=", c: "k" }, { t: " " }, { t: "await", c: "k" }, { t: " returnsplit." }, { t: "plan", c: "fn" }, { t: "({" }],
  [{ t: "  claim", c: "n" }, { t: ": " }, { t: "\"RET-260903-031\"", c: "s" }, { t: "," }],
  [{ t: "  returnedLines", c: "n" }, { t: ": [{ sku: " }, { t: "\"indigo-kurta\"", c: "s" }, { t: ", qty: " }, { t: "1", c: "n" }, { t: " }]," }],
  [{ t: "});" }],
  [],
  [{ t: "// balanced, integer paise - nothing has moved yet", c: "c" }],
  [{ t: "plan." }, { t: "customerRefundPaise", c: "n" }, { t: ";     " }, { t: "// 232854", c: "c" }],
  [{ t: "plan." }, { t: "reversals", c: "n" }, { t: ";               " }, { t: "// [{ account: 'acc_demo_aavya', paise: 197926 }]", c: "c" }],
  [{ t: "plan." }, { t: "marketplaceFundedPaise", c: "n" }, { t: ";  " }, { t: "// 34928", c: "c" }],
  [],
  [{ t: "await", c: "k" }, { t: " returnsplit." }, { t: "execute", c: "fn" }, { t: "(plan." }, { t: "id", c: "n" }, { t: ", {" }],
  [{ t: "  approvedBy", c: "n" }, { t: ": operator,     " }, { t: "// maker-checker, bound to fingerprint", c: "c" }],
  [{ t: "});" }],
];

/* marquee content - real claims + amounts */
const TICKER: React.ReactNode[] = [
  <><b>RET-260903-031</b> reverse <span className="t">₹1,979.26</span> → Aavya Textiles</>,
  <><b>RET-260831-024</b> settled <span className="t">₹1,499.00</span> → Field Notes</>,
  <>Σ reversals + platform = customer refund</>,
  <><b>RET-260903-038</b> <span className="g">shortfall</span> · only ₹49.15 reversible</>,
  <><b>MM-18472</b> Aavya Textiles + Noya Footwear · buyer keeps the sneakers</>,
  <>64 / 64 fixtures · 0 unsafe automations · ₹0 wrong-seller</>,
];

const RIBBON: string[] = [
  "Integer-paise math",
  "Provably balanced",
  "Never holds funds",
  "Idempotent execution",
  "Fail-closed by default",
  "Human approval gate",
  "Tamper-evident trail",
  "Right transfer, every time",
];

/* ---------- fanned control-surface cards (refs: Aeline floating arc + Rooms glass) ---------- */
type FanCard = { tag: string; tone: string; ico: React.ReactNode; title: React.ReactNode; body: React.ReactNode; foot: React.ReactNode };
const FAN: FanCard[] = [
  { tag: "Evidence", tone: "blue", ico: I.inbox, title: "RET-260903-031", body: <>Order <b>MM-18472</b> · Aavya + Noya</>, foot: <><span className="lp-ava-stack"><i /><i /></span>2 sellers</> },
  { tag: "Split", tone: "gold", ico: I.calc, title: "Per-seller paise", body: <>₹1,979.26 <span className="lp-fcard-sep">·</span> ₹349.28</>, foot: <>{I.check} integer-paise</> },
  { tag: "Reverse", tone: "green", ico: I.refresh, title: "₹1,979.26", body: <>&rarr; Aavya Textiles</>, foot: <>acc_demo_aavya</> },
  { tag: "Approve", tone: "green", ico: I.lock, title: "Maker-checker", body: <>signed · fingerprint bound</>, foot: <><span className="lp-ava-stack"><i /></span>operator</> },
  { tag: "Reconcile", tone: "green", ico: I.scroll, title: "Balanced", body: <>Σ reversals + platform = refund</>, foot: <>{I.check} 0 wrong-seller</> },
];

/* ---------- hero product panel: faithful mini-workbench ---------- */
function Workbench() {
  const { ref, seen } = useInView<HTMLDivElement>(0.3);
  const total = useCountUp(CUSTOMER, seen);
  const aavya = useCountUp(AAVYA, seen);
  const market = useCountUp(MARKET, seen);
  const tilt = useTilt<HTMLDivElement>();
  return (
    <div className="lp-frame-wrap" ref={ref}>
      <div className="lp-frame-glow" />
      <div className="lp-frame" ref={tilt}>
        <div className="lp-wb">
          <aside className="lp-wb-side">
            <div className="lp-wb-brand"><Mark />ReturnSplit</div>
            <nav className="lp-wb-nav">
              <a className="on">{I.inbox} Claims</a>
              <a>{I.pkg} Orders</a>
              <a>{I.file} Policies</a>
              <a>{I.shield} Reserve</a>
              <a>{I.activity} Activity</a>
            </nav>
            <div className="lp-wb-badge">
              <i />
              <div><b>Simulation</b><span>No live money</span></div>
            </div>
          </aside>
          <div className="lp-wb-main">
            <div className="lp-wb-crumb">Claims › RET-260903-031</div>
            <div className="lp-wb-head">
              <h4>Return claim RET-260903-031</h4>
              <span className="lp-pill green">Ready for approval</span>
            </div>
            <div className="lp-wb-meta">Order MM-18472 · Maya Rao · Received 3 Sep 2026 · Mora Supplier Terms v3.2 §7.3</div>
            <div className="lp-wb-grid">
              <div className="lp-mm">
                <div className="lp-mm-h">Money movement</div>
                <div className="lp-mm-row">
                  <span className="lp-mm-ic rev">{I.arrowLeft}</span>
                  <span className="lp-mm-name">Aavya Textiles<small>reverse Route transfer</small></span>
                  <span className="lp-mm-amt rev">−{rupees(aavya)}</span>
                </div>
                <div className="lp-mm-row">
                  <span className="lp-mm-ic con">{I.plus}</span>
                  <span className="lp-mm-name">Marketplace<small>commission contribution</small></span>
                  <span className="lp-mm-amt con">−{rupees(market)}</span>
                </div>
                <div className="lp-mm-row">
                  <span className="lp-mm-ic zero">{I.minus}</span>
                  <span className="lp-mm-name">Shipping<small>non-refundable on partial</small></span>
                  <span className="lp-mm-amt zero">{rupees(0)}</span>
                </div>
                <div className="lp-mm-total">
                  <span>Customer refund</span>
                  <b>{rupees(total)}</b>
                </div>
                <div className="lp-inv">{I.check}<span>Balances to the paise - <code>Σ reversals + platform = refund</code></span></div>
              </div>
              <div className="lp-act">
                <div className="lp-act-eye">Approval summary</div>
                <div className="lp-act-amt">{rupees(total)}</div>
                <div className="lp-act-sub">1 transfer reversed · buyer keeps the sneakers</div>
                <div className="lp-act-div" />
                <div className="lp-approve lp-pulse">{I.check} Approve &amp; execute</div>
                <div className="lp-safe">{I.lock} Signed by Priyanshu · maker-checker</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Mark() {
  return <span className="lp-mark"><span /><span /></span>;
}

/* ---------- control report (assurance) ---------- */
function ControlReport() {
  const { ref, seen } = useInView<HTMLDivElement>(0.35);
  const fixtures = useCountUp(64, seen, 1300);
  const recon = useCountUp(100, seen, 1300);
  return (
    <div className="lp-report" ref={ref}>
      <div className="lp-report-bar">
        <span>returnsplit-engine · control-set v2 · 64 synthetic records</span>
        <span className="pass">PASS</span>
      </div>
      <div className="lp-report-body">
        <div className="lp-report-row">
          <span className="lbl">fixture assertions</span>
          <span className="lead" />
          <span className="val">{fixtures}<em> / 64</em></span>
        </div>
        <div className="lp-report-row">
          <span className="lbl">unsafe automations</span>
          <span className="lead" />
          <span className="val">0</span>
        </div>
        <div className="lp-report-row">
          <span className="lbl">paise to the wrong seller</span>
          <span className="lead" />
          <span className="val">₹0</span>
        </div>
        <div className="lp-report-row">
          <span className="lbl">reconciled to Razorpay</span>
          <span className="lead" />
          <span className="val">{recon}<em> %</em></span>
        </div>
      </div>
    </div>
  );
}

/* ---------- FAQ ---------- */
const FAQS: { q: string; a: string }[] = [
  { q: "Does ReturnSplit ever hold my money?", a: "No. ReturnSplit is an orchestration layer - it reasons about the split and calls your own Razorpay account to move funds. It never pools or custodies money, so it is not a payment aggregator. Razorpay stays the system of record." },
  { q: "How is this different from Razorpay's refund API?", a: "For a partial refund on a payment split across multiple Route transfers, Razorpay cannot decide which transfer to reverse - its own docs say so. ReturnSplit computes the exact per-seller paise, reverses the right transfers, then refunds the buyer, in one crash-safe order." },
  { q: "What if a seller already withdrew their payout?", a: "That is the shortfall case (see claim RET-260903-038: only ₹49.15 was reversible). ReturnSplit reverses what exists, opens an exception case, and carries the residual - it never silently absorbs a loss or blindly retries." },
  { q: "Is the money math actually safe?", a: "Every rupee is computed in integer paise with largest-remainder rounding - no floats. Across a 64-record synthetic control set the engine passed 64/64 fixture assertions with 0 rounding drift, ₹0 mis-attributed to the wrong seller, and 0 unsafe automations. If a plan doesn't balance to the paise, it doesn't run." },
  { q: "What about audit and compliance?", a: "Every decision is written to a hash-chained, append-only trail - the kind of 8-year, non-disableable, India-resident record MCA Rule 3(1) expects. Each executed plan reconciles back against Razorpay as the source of truth." },
  { q: "Can I try it on my own returns?", a: "Open the workbench and walk a real partial-refund claim end to end - the per-seller split, the reversals, the approval step, and the reconciled trail. Every figure is deterministic, so you can replay the same claim and get the same paise." },
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
            <a href="#features">Control</a>
            <a href="#assurance">Assurance</a>
            <a href="#developers">Developers</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="lp-nav-cta">
            <a className="lp-btn lp-btn-ghost" href="/claims/RET-260903-031">See a live claim</a>
            <a className="lp-btn lp-btn-primary" href="/claims">Open the workbench</a>
          </div>
        </div>
      </nav>

      {/* hero */}
      <header className="lp-hero" id="top">
        <div className="lp-dots" />
        <div className="lp-wrap lp-hero-inner">
          <span className="lp-eyebrow">Razorpay Route · partial marketplace refunds</span>
          <h1>
            <span>Refund one item.</span>
            <span>Reverse the <em>exact</em> sellers.</span>
          </h1>
          <p className="lp-hero-sub">
            When a buyer returns part of a multi-vendor order, Razorpay can&rsquo;t tell which transfer to reverse.
            ReturnSplit computes the correct per-seller paise, reverses the right Route transfers, then refunds the
            buyer - behind a human approval and a tamper-evident trail.
          </p>
          <div className="lp-hero-actions">
            <a className="lp-btn lp-btn-primary lp-btn-lg" href="/claims">Open the workbench {I.arrow}</a>
            <a className="lp-btn lp-btn-ghost lp-btn-lg" href="/claims">See a live claim</a>
          </div>
          <div className="lp-hero-trust">
            <span>{I.check} Integer-paise, provably balanced</span>
            <span>{I.check} Never touches your funds</span>
            <span>{I.check} Idempotent, fail-closed execution</span>
          </div>
        </div>
        <div className="lp-wrap"><Workbench /></div>
      </header>

      {/* marquee */}
      <div className="lp-marquee" aria-hidden>
        <div className="lp-marq-track">
          {[0, 1].map((dup) => (
            <div className="lp-marq-item" key={dup}>
              {TICKER.map((node, i) => (
                <span key={i}>
                  {node}<span className="lp-marq-sep">/</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* crossing ribbons */}
      <div className="lp-ribbons" aria-hidden>
        <div className="lp-ribbon lp-ribbon-a">
          <div className="lp-ribbon-track">
            {[0, 1, 2].map((dup) => (
              <span className="lp-ribbon-item" key={dup}>
                {RIBBON.map((t, i) => (
                  <span key={i}>{t}<span className="lp-ribbon-star">✳</span></span>
                ))}
              </span>
            ))}
          </div>
        </div>
        <div className="lp-ribbon lp-ribbon-b">
          <div className="lp-ribbon-track rev">
            {[0, 1, 2].map((dup) => (
              <span className="lp-ribbon-item" key={dup}>
                {RIBBON.map((t, i) => (
                  <span key={i}>{t}<span className="lp-ribbon-star">✳</span></span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* control surface - fanned floating cards */}
      <section className="lp-section lp-fan-sec" id="surface">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-section-head center">
              <span className="lp-index">Part. 01</span>
              <span className="lp-eyebrow sq">The control surface <span className="lp-spark">✳</span></span>
              <h2>One claim, five states, nothing hidden.</h2>
              <p>Every partial return moves through the same auditable surface - evidence, split,
                reversal, approval, reconciliation. Here it is, mid-flight.</p>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-fan">
              <div className="lp-fan-toast"><span className="lp-fan-dot" />Reversal confirmed · 0.42s <b>idempotent</b></div>
              <div className="lp-fan-arc">
                {FAN.map((c, i) => (
                  <article className={`lp-fcard p${i + 1}`} style={{ "--i": i } as React.CSSProperties} key={c.tag}>
                    <div className="lp-fcard-top">
                      <span className={`lp-fcard-tag ${c.tone}`}>{c.tag}</span>
                      <span className="lp-fcard-ico">{c.ico}</span>
                    </div>
                    <div className="lp-fcard-title">{c.title}</div>
                    <div className="lp-fcard-body">{c.body}</div>
                    <div className="lp-fcard-foot">{c.foot}</div>
                  </article>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* proof quote */}
      <section className="lp-proof">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-doc">
              <div className="lp-doc-body">
                <blockquote>
                  For partial refunds on a payment transferred to multiple accounts, <b>Razorpay cannot determine which
                  transfer to reverse partially.</b> You will have to use the transfer reversal API.
                </blockquote>
                <div className="lp-doc-cite">
                  <b>Razorpay Route - official documentation.</b>
                  <a href="https://razorpay.com/docs/payments/route/refunds/" target="_blank" rel="noreferrer">razorpay.com/docs/payments/route/refunds</a>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* pipeline */}
      <section className="lp-section lp-band" id="how">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-section-head center">
              <span className="lp-eyebrow sq">The control loop</span>
              <h2>Evidence in. Correct money out. Every step recorded.</h2>
              <p>ReturnSplit runs one auditable state machine after a return is raised. Reversals are compensable and
                retryable; the buyer refund is the single point of no return.</p>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-flow">
              <div className="lp-flow-line" />
              <div className="lp-flow-grid">
                {[
                  { n: "1", verb: "Assess", t: "needs_review", d: "Untrusted evidence and the policy citation are validated against the real order. AI proposes a split - it never decides money.", on: true },
                  { n: "2", verb: "Approve", t: "ready_for_approval", d: "A named operator signs the frozen plan, bound to an exact fingerprint. Maker-checker, enforced server-side.", on: true },
                  { n: "3", verb: "Execute", t: "processing", d: "Pre-flight re-fetch, fail-closed on drift, then Route reversals run to confirmed - idempotent and resumable.", on: true },
                  { n: "4", verb: "Settle", t: "completed", d: "The buyer is refunded only after reversals confirm, then the whole plan reconciles against Razorpay.", on: true },
                ].map((s) => (
                  <div key={s.n} className={`lp-stage${s.on ? " on" : ""}`}>
                    <div className="lp-stage-node">{s.n}</div>
                    <div className="lp-stage-verb">{s.verb}</div>
                    <code>{s.t}</code>
                    <p>{s.d}</p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-branch">
              <span><i className="d" style={{ background: "var(--lp-gold)" }} /> needs_review → evidence requested</span>
              <span><i className="d" style={{ background: "var(--lp-danger)" }} /> blocked → manual intervention</span>
              <span><i className="d" style={{ background: "var(--lp-blue)" }} /> reversal_result_unknown → safe reconcile</span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* features bento */}
      <section className="lp-section" id="features">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-section-head">
              <span className="lp-eyebrow sq">What you get</span>
              <h2>The missing brain between a return and your payout ledger.</h2>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-bento">
              <div className="lp-cell lp-c-a">
                <span className="lp-cell-idx">01</span>
                <div className="lp-cell-t">{I.calc}<h3>Exact-paise allocation</h3></div>
                <p>Every rupee computed in integer paise with largest-remainder rounding - no floats, no drift. The split
                  sums to the refund, to the last paisa, or it never runs.</p>
                <div className="lp-demo">
                  <div className="lp-demo-row"><span>Aavya Textiles · reverse</span><b className="t">−₹1,979.26</b></div>
                  <div className="lp-demo-row"><span>Marketplace · contribute</span><b className="g">−₹349.28</b></div>
                  <div className="lp-demo-row"><span>Shipping · non-refundable</span><b>₹0.00</b></div>
                  <div className="lp-demo-row tot"><span>Customer refund</span><b>₹2,328.54</b></div>
                </div>
              </div>
              <div className="lp-cell lp-c-b">
                <span className="lp-cell-idx">02</span>
                <div className="lp-cell-t">{I.refresh}<h3>Shortfall recovery</h3></div>
                <p>When a seller has already drained their float, the reversal can&rsquo;t pull it all back. ReturnSplit
                  reverses what exists, opens an exception, and carries the residual - never a silent loss.</p>
                <div className="lp-cell-spacer" />
                <div className="lp-block">
                  <div className="lp-block-h">
                    <span className="lp-mono">RET-260903-038 · Kabir Sen</span>
                    <span className="lp-pill red">Blocked</span>
                  </div>
                  <p>Needs ₹850.85 · only ₹49.15 reversible → manual intervention, residual carried.</p>
                </div>
              </div>
              <div className="lp-cell lp-c-c">
                <span className="lp-cell-idx">03</span>
                <div className="lp-cell-t">{I.shield}<h3>Idempotent &amp; fail-closed</h3></div>
                <p>A timed-out reversal is an unknown, never a blind retry. Fetch-and-match reconcile means no double
                  clawback.</p>
                <div className="lp-cell-spacer" />
                <span className="lp-tag">reversal_result_unknown → reconcile</span>
              </div>
              <div className="lp-cell lp-c-d">
                <span className="lp-cell-idx">04</span>
                <div className="lp-cell-t">{I.scroll}<h3>Tamper-evident trail</h3></div>
                <div className="lp-tl">
                  <div className="lp-tl-row"><span className="lp-tl-dot">{I.check}</span><span className="lp-tl-b">Plan frozen<small>Priyanshu · 08:57</small></span></div>
                  <div className="lp-tl-row"><span className="lp-tl-dot">{I.check}</span><span className="lp-tl-b">Transfer reversed<small>trf_demo_Q8aavya</small></span></div>
                  <div className="lp-tl-row"><span className="lp-tl-dot">{I.check}</span><span className="lp-tl-b">Buyer refunded<small>reconciled ✓</small></span></div>
                </div>
              </div>
              <div className="lp-cell lp-c-e">
                <span className="lp-cell-idx">05</span>
                <div className="lp-cell-t">{I.trend}<h3>Exposure forecasting</h3></div>
                <p>TimesFM 2.5 projects aggregate refund exposure for reserve planning - advisory only, not approved for
                  production.</p>
                <div className="lp-wape">
                  <div><b>3.77%</b><span>7-day WAPE</span></div>
                  <div><b>3.43%</b><span>14-day</span></div>
                  <div><b>3.71%</b><span>30-day</span></div>
                </div>
              </div>
              <div className="lp-cell lp-c-f">
                <div className="lp-cf-copy">
                  <span className="lp-cell-idx">06</span>
                  <div className="lp-cell-t">{I.layers}<h3>Cross-rail by design</h3></div>
                  <p>One reversal-and-reconciliation layer across Razorpay Route, Stripe Connect and Cashfree - the same
                    balanced plan, whichever rail the money sits on.</p>
                </div>
                <span className="lp-tag">ON THE ROADMAP</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* assurance / stats */}
      <section className="lp-section lp-ink-sec" id="assurance">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-section-head center">
              <span className="lp-eyebrow">Assurance</span>
              <h2>Boring where it counts. Provable where it matters.</h2>
              <p>ReturnSplit reasons about the money and calls your Razorpay account to move it. It never holds or pools
                funds - so it is an orchestration layer, not a payment aggregator. Here is the full control-set readout.</p>
            </div>
          </Reveal>
          <Reveal>
            <ControlReport />
          </Reveal>
        </div>
      </section>

      {/* developers */}
      <section className="lp-section lp-band" id="developers">
        <div className="lp-wrap lp-codewrap">
          <Reveal>
            <div className="lp-section-head">
              <span className="lp-eyebrow sq">For developers</span>
              <h2>One call. The right transfers.</h2>
              <p>Hand ReturnSplit the approved return and the order. It returns a frozen, balanced plan and - after
                approval - executes the reversals and refund as one crash-safe saga.</p>
              <div className="lp-hero-actions" style={{ justifyContent: "flex-start", marginTop: 24 }}>
                <a className="lp-btn lp-btn-ghost" href="/claims">Explore the workbench {I.arrow}</a>
              </div>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-code">
              <div className="lp-code-bar"><i /><i /><i /><span>plan.ts</span></div>
              <pre><code>{CODE.map((line, i) => (
                <span className="lp-cl" key={i}>
                  {line.length === 0 ? " " : line.map((tok, j) => (
                    <span key={j} className={tok.c ?? undefined}>{tok.t}</span>
                  ))}
                </span>
              ))}</code></pre>
            </div>
          </Reveal>
        </div>
      </section>

      {/* faq */}
      <section className="lp-section" id="faq">
        <div className="lp-wrap lp-faq">
          <div className="lp-faq-left">
            <span className="lp-eyebrow sq">FAQ</span>
            <h2>Questions? Answered.</h2>
            <p>Still stuck? Mail <a href="mailto:hello@returnsplit.dev">hello@returnsplit.dev</a> and a human replies.</p>
          </div>
          <div className="lp-faq-list">
            {FAQS.map((f, i) => (
              <FaqItem key={i} q={f.q} a={f.a} open={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? -1 : i)} />
            ))}
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="lp-section" id="cta" style={{ paddingTop: 0 }}>
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-cta-card">
              <div className="lp-dots" />
              <h2>See exactly which transfer to reverse.</h2>
              <p>Open the workbench and walk a real partial-refund claim end to end - the per-seller split, the
                right reversals, human approval, and the reconciled trail.</p>
              <div className="lp-cta-actions">
                <a className="lp-btn lp-btn-primary lp-btn-lg" href="/claims">Open the workbench {I.arrow}</a>
                <a className="lp-btn lp-btn-ghost lp-btn-lg" href="/claims/RET-260903-031">See a live claim</a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* footer */}
      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-top">
            <div className="lp-footer-lead">
              <a className="lp-word lg" href="#top">Return<span className="s">Split</span></a>
              <p>A financial control layer for safe, explainable marketplace return reversals on Razorpay Route.</p>
            </div>
            <div className="lp-footer-col">
              <h5>Product</h5>
              <a href="#how">How it works</a>
              <a href="#features">Control</a>
              <a href="#assurance">Assurance</a>
              <a href="/claims">Workbench</a>
            </div>
            <div className="lp-footer-col">
              <h5>Developers</h5>
              <a href="#developers">API</a>
              <a href="https://razorpay.com/docs/payments/route/" target="_blank" rel="noreferrer">Route docs</a>
              <a href="/evaluation">Evaluation</a>
            </div>
            <div className="lp-footer-col">
              <h5>Company</h5>
              <a href="/claims">Open workbench</a>
              <a href="mailto:hello@returnsplit.dev">Get in touch</a>
              <a href="#faq">FAQ</a>
            </div>
          </div>
          <div className="lp-footer-note">
            <span>ReturnSplit orchestrates refunds on your Razorpay account and never holds funds. Demo figures use a deterministic simulator; no live money moves.</span>
            <span>© 2026 ReturnSplit</span>
          </div>
        </div>
        <div className="lp-ghost" aria-hidden><span>Return<em>Split</em></span></div>
      </footer>
    </>
  );
}
