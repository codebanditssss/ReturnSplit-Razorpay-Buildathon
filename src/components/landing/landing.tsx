"use client";

import Link from "next/link";
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
      const raf = requestAnimationFrame(() => setV(target));
      return () => cancelAnimationFrame(raf);
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

/* ---------- seeded golden-case fixture (order MM-18472 / claim RET-260903-031) ---------- */
const CUSTOMER = 232854;  // ₹2,328.54 customer refund
const AAVYA = 197926;     // ₹1,979.26 reversed from Aavya Textiles
const MARKET = 34928;     // ₹349.28 marketplace contribution

/* code sample rendered from tokens so no literal braces sit in JSX text */
type Tok = { t: string; c?: string };
const CODE: Tok[][] = [
  [{ t: "const", c: "k" }, { t: " claimId " }, { t: "=", c: "k" }, { t: " " }, { t: "\"RET-260903-031\"", c: "s" }, { t: ";" }],
  [{ t: "const", c: "k" }, { t: " endpoint " }, { t: "=", c: "k" }, { t: " " }, { t: "`/api/claims/${claimId}/preflight`", c: "s" }, { t: ";" }],
  [],
  [{ t: "// Re-fetch provider state before approval", c: "c" }],
  [{ t: "const", c: "k" }, { t: " check " }, { t: "=", c: "k" }, { t: " " }, { t: "await", c: "k" }, { t: " " }, { t: "fetch", c: "fn" }, { t: "(endpoint, {" }],
  [{ t: "  method", c: "n" }, { t: ": " }, { t: "\"POST\"", c: "s" }, { t: "," }],
  [{ t: "  body", c: "n" }, { t: ": JSON.stringify({ expectedPlanFingerprint })," }],
  [{ t: "});" }],
  [],
  [{ t: "if", c: "k" }, { t: " (!check.ok) " }, { t: "return", c: "k" }, { t: " " }, { t: "\"fail_closed\"", c: "s" }, { t: ";" }],
  [{ t: "// Approval uses the same reviewed fingerprint", c: "c" }],
  [{ t: "// and executes through the server-side saga.", c: "c" }],
];

/* ---------- control-surface states (one seeded demo claim, RET-260903-031) ---------- */
type SurfaceStep = { tag: string; tone: string; title: string; state: string; body: React.ReactNode };
const STEPS: SurfaceStep[] = [
  { tag: "Evidence", tone: "blue", title: "Return logged", state: "evidence_received", body: <>Order <b>MM-18472</b> · 2 items across Aavya + Noya · precomputed returned-line and reason fixture.</> },
  { tag: "Split", tone: "gold", title: "Refund apportioned", state: "plan_balanced", body: <>
    <b>₹2,328.54</b> refund resolves to <b>₹1,979.26</b> seller reversal + <b>₹349.28</b> platform contribution, in integer paise.
    <span className="lp-splitbar" aria-hidden>
      <span className="lp-splitseg rev" style={{ width: "85%" }} />
      <span className="lp-splitseg con" style={{ width: "15%" }} />
    </span>
    <span className="lp-splitlegend">
      <span className="rev"><i />Aavya reversal · <b>₹1,979.26</b> · 85%</span>
      <span className="con"><i />Platform · <b>₹349.28</b> · 15%</span>
    </span>
  </> },
  { tag: "Reverse", tone: "green", title: "Route reversal drafted", state: "reversal_prepared", body: <>The plan targets <b>₹1,979.26</b> against Aavya Textiles&rsquo; seeded Route transfer; after approval, execution records intent and a stable receipt before submission.</> },
  { tag: "Approve", tone: "green", title: "Human approval held", state: "ready_for_approval", body: <>Nothing moves until a named operator signs off; the exact plan fingerprint is bound to that approval.</> },
  { tag: "Reconcile", tone: "green", title: "Simulated and closed", state: "completed", body: <>The simulator confirms the seller reversal before the customer refund · balanced to the paise.</> },
];

/* ---------- hero product panel: faithful mini-workbench ---------- */
function Workbench() {
  const { ref, seen } = useInView<HTMLDivElement>(0.3);
  const total = useCountUp(CUSTOMER, seen);
  const aavya = useCountUp(AAVYA, seen);
  const market = useCountUp(MARKET, seen);
  return (
    <div className="lp-frame-wrap" ref={ref}>
      <div className="lp-frame-glow" />
      <div className="lp-frame">
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
            <div className="lp-wb-meta">Order MM-18472 · Maya Rao · Received 3 Sep 2026 · Creo Market Returns v3.2 §7.3</div>
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
                <div className="lp-act-sub">1 transfer to reverse · buyer keeps the sneakers</div>
                <div className="lp-act-div" />
                <div className="lp-approve lp-pulse">{I.check} Approve &amp; execute</div>
                <div className="lp-safe">{I.lock} Named operator · fingerprint-bound plan</div>
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
  const exceptions = useCountUp(16, seen, 1300);
  return (
    <div className="lp-report" ref={ref}>
      <div className="lp-report-bar">
        <span>returnsplit-engine · deterministic control set · 64 records</span>
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
          <span className="lbl">wrong-seller overage</span>
          <span className="lead" />
          <span className="val">₹0</span>
        </div>
        <div className="lp-report-row">
          <span className="lbl">expected exceptions surfaced</span>
          <span className="lead" />
          <span className="val">{exceptions}<em> / 16</em></span>
        </div>
      </div>
    </div>
  );
}

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
  const [activeStep, setActiveStep] = useState(1);
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
            <Link className="lp-btn lp-btn-ghost" href="/claims/RET-260903-031">View demo claim</Link>
            <Link className="lp-btn lp-btn-primary" href="/claims">Open the workbench</Link>
          </div>
        </div>
      </nav>

      {/* hero */}
      <header className="lp-hero" id="top">
        <div className="lp-dots" />
        <div className="lp-wrap lp-hero-inner">
          <span className="lp-eyebrow">Track 04 finance control · working test-mode prototype</span>
          <h1>
            <span>One item comes back.</span>
            <span>Reverse the <em>exact</em> transfer.</span>
          </h1>
          <p className="lp-hero-sub">
            A buyer sends part of a multi-vendor order back, and Razorpay Route can&rsquo;t tell whose transfer to
            unwind. ReturnSplit computes each seller&rsquo;s share to the last paisa, then the simulator or Test Mode
            adapter follows reversal-before-refund ordering behind human approval and a process-local audit history.
          </p>
          <div className="lp-hero-actions">
            <Link className="lp-btn lp-btn-primary lp-btn-lg" href="/claims">Open the workbench {I.arrow}</Link>
            <Link className="lp-btn lp-btn-ghost lp-btn-lg" href="/claims/RET-260903-031">View demo claim</Link>
          </div>
          <div className="lp-hero-trust">
            <span>{I.check} Exact integer-paise planning</span>
            <span>{I.check} No custody · simulation or Test Mode</span>
            <span>{I.check} Unknown outcomes pause for reconciliation</span>
          </div>
        </div>
        <div className="lp-wrap"><Workbench /></div>
      </header>

      <div className="lp-evidence-rail" aria-label="Prototype evidence">
        <div className="lp-wrap lp-evidence-grid">
          <span><i />Working demo</span>
          <span><b>64 / 64</b> control fixtures</span>
          <span><b>₹0</b> wrong-seller allocation</span>
          <span>Deterministic test provider</span>
        </div>
      </div>

      {/* control surface - one framed audit panel */}
      <section className="lp-section lp-fan-sec" id="surface">
        <div className="lp-wrap">
          <Reveal>
            <div className="lp-section-head center">
              <span className="lp-eyebrow sq">The control surface</span>
              <h2>One seeded claim, five illustrated steps.</h2>
              <p>Each seeded scenario is presented on the same reviewable surface - evidence, split, reversal, approval,
                reconciliation. Here is demo claim RET-260903-031, start to close.</p>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-surface">
              <div className="lp-surface-bar">
                <span className="lp-surface-id">{I.scroll}RET-260903-031</span>
                <span className="lp-surface-live"><span className="lp-fan-dot" />Simulation · reversal before refund · <b>replayable</b></span>
              </div>
              <div className="lp-surface-metrics" aria-label="Claim summary">
                <span><small>Refund</small><b>₹2,328.54</b></span>
                <span><small>Seller reversal</small><b>₹1,979.26</b></span>
                <span><small>Platform share</small><b>₹349.28</b></span>
              </div>
              <div className="lp-surface-workspace">
                <ol className="lp-surface-rail" aria-label="Claim replay steps">
                  {STEPS.map((s, i) => (
                    <li className={`lp-srow${activeStep === i ? " active" : ""}`} key={s.tag}>
                      <button type="button" onClick={() => setActiveStep(i)} aria-label={`${s.tag}: ${s.title}`} aria-pressed={activeStep === i}>
                        <span className="lp-srow-node">{i < activeStep ? I.check : i + 1}</span>
                        <span className="lp-srow-main">
                          <span className="lp-srow-head">
                            <span className={`lp-fcard-tag ${s.tone}`}>{s.tag}</span>
                            <span className="lp-srow-title">{s.title}</span>
                          </span>
                          <code>{s.state}</code>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                <aside className="lp-surface-drawer" aria-live="polite">
                  <div className="lp-drawer-head">
                    <span>Step {String(activeStep + 1).padStart(2, "0")} / 05</span>
                    <span className={`lp-fcard-tag ${STEPS[activeStep].tone}`}>{STEPS[activeStep].tag}</span>
                  </div>
                  <div className="lp-drawer-body" key={activeStep}>
                    <span className="lp-eyebrow">Replay evidence</span>
                    <h3>{STEPS[activeStep].title}</h3>
                    <div className="lp-drawer-copy">{STEPS[activeStep].body}</div>
                    <dl className="lp-drawer-facts">
                      <div><dt>Environment</dt><dd>Test mode</dd></div>
                      <div><dt>Order</dt><dd>MM-18472</dd></div>
                      <div><dt>Policy</dt><dd>Creo Market v3.2</dd></div>
                    </dl>
                  </div>
                  <div className="lp-drawer-actions">
                    <button type="button" onClick={() => setActiveStep((activeStep + STEPS.length - 1) % STEPS.length)}>{I.arrowLeft} Previous</button>
                    <button type="button" onClick={() => setActiveStep((activeStep + 1) % STEPS.length)}>Next step {I.arrow}</button>
                  </div>
                </aside>
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
              <h2>Evidence in. Balanced plan out. Each demo step recorded.</h2>
              <p>After a return is approved, the prototype runs a reviewable state machine. It records intent before
                provider calls, pauses unknown outcomes for reconciliation, and waits for confirmed reversals before refunding.</p>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-flow">
              <div className="lp-flow-line" />
              <div className="lp-flow-grid">
                {[
                  { n: "1", verb: "Assess", t: "needs_review", d: "Precomputed returned-line and policy fixtures are treated as untrusted, validated against the seeded order, then passed to deterministic paise calculation.", on: true },
                  { n: "2", verb: "Approve", t: "ready_for_approval", d: "A named operator approves the frozen plan, bound to an exact fingerprint. Separate maker-checker roles and RBAC remain production work.", on: true },
                  { n: "3", verb: "Execute", t: "processing", d: "Pre-flight re-fetch fails closed on drift. Intent and a stable receipt are recorded so unknown Route outcomes pause for reconciliation, not a blind retry.", on: true },
                  { n: "4", verb: "Settle", t: "completed", d: "The customer refund starts only after required reversals confirm; the simulator or configured Test Mode status is then recorded.", on: true },
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
              <span><i className="d" style={{ background: "var(--lp-blue)" }} /> reversal_result_unknown → receipt-based reconcile</span>
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
                <div className="lp-cell-t">{I.refresh}<h3>Shortfall handling</h3></div>
                <p>When the reversible transfer balance is too low, the demo blocks approval, shows the residual, and
                  can open an owned payments-reconciliation case instead of moving partial money.</p>
                <div className="lp-cell-spacer" />
                <div className="lp-block">
                  <div className="lp-block-h">
                    <span className="lp-mono">RET-260903-038 · Kabir Sen</span>
                    <span className="lp-pill red">Approval blocked</span>
                  </div>
                  <p>Needs ₹850.85 · only ₹49.15 reversible → approval blocked, reconciliation required.</p>
                </div>
              </div>
              <div className="lp-cell lp-c-c">
                <span className="lp-cell-idx">03</span>
                <div className="lp-cell-t">{I.shield}<h3>Fail-closed retry safety</h3></div>
                <p>A timed-out reversal becomes unknown, never a blind retry. The prototype fetches by stable receipt;
                  durable cross-process protection remains production work.</p>
                <div className="lp-cell-spacer" />
                <span className="lp-tag">reversal_result_unknown → reconcile</span>
              </div>
              <div className="lp-cell lp-c-d">
                <span className="lp-cell-idx">04</span>
                <div className="lp-cell-t">{I.scroll}<h3>Process-local audit history</h3></div>
                <div className="lp-tl">
                  <div className="lp-tl-row"><span className="lp-tl-dot">{I.check}</span><span className="lp-tl-b">Plan frozen<small>Khushi Diwan · 08:57</small></span></div>
                  <div className="lp-tl-row"><span className="lp-tl-dot">{I.check}</span><span className="lp-tl-b">Demo transfer reversed<small>masked simulator reference</small></span></div>
                  <div className="lp-tl-row"><span className="lp-tl-dot">{I.check}</span><span className="lp-tl-b">Demo refund completed<small>simulator status recorded</small></span></div>
                </div>
              </div>
              <div className="lp-cell lp-c-e">
                <span className="lp-cell-idx">05</span>
                <div className="lp-cell-t">{I.trend}<h3>Exposure forecasting</h3></div>
                <p>A dated TimesFM 2.5 backtest measured aggregate refund exposure on 56 synthetic daily totals. It is
                  illustrative planning evidence, not production accuracy.</p>
                <div className="lp-wape">
                  <div><b>3.77%</b><span>7-day WAPE</span></div>
                  <div><b>3.43%</b><span>14-day</span></div>
                  <div><b>3.71%</b><span>30-day</span></div>
                </div>
              </div>
              <div className="lp-cell lp-c-f">
                <div className="lp-cf-copy">
                  <span className="lp-cell-idx">06</span>
                  <div className="lp-cell-t">{I.layers}<h3>Cross-rail roadmap</h3></div>
                  <p>The prototype implements Razorpay Route simulation and an optional Test Mode adapter. Stripe Connect
                    and Cashfree are roadmap research; no adapters are included.</p>
                </div>
                <span className="lp-tag">PROPOSED ROADMAP · NOT IMPLEMENTED</span>
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
              <p>The prototype calculates the money plan without holding or pooling funds. Its default provider is a
                deterministic simulator; an optional Razorpay Test Mode adapter is available, and live keys are rejected.</p>
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
              <span className="lp-eyebrow sq">Engine contract</span>
              <h2>Plan first. Execute after approval.</h2>
              <p>The workbench posts the reviewed fingerprint to its same-origin preflight route before approval, then
                enforces reversal-before-refund ordering. Demo state is process-local.</p>
              <div className="lp-hero-actions" style={{ justifyContent: "flex-start", marginTop: 24 }}>
                <Link className="lp-btn lp-btn-ghost" href="/claims">Explore the workbench {I.arrow}</Link>
              </div>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-code">
              <div className="lp-code-bar"><i /><i /><i /><span>conceptual-flow.ts</span></div>
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
            <p>Start with the <Link href="/claims/RET-260903-031">golden claim</Link>, then inspect the <Link href="/evaluation">evaluation snapshot</Link>.</p>
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
              <p>Open the workbench and replay a seeded partial-refund scenario - the per-seller split, approval gate,
                simulated execution, and process-local audit history.</p>
              <div className="lp-cta-actions">
                <Link className="lp-btn lp-btn-primary lp-btn-lg" href="/claims">Open the workbench {I.arrow}</Link>
                <Link className="lp-btn lp-btn-ghost lp-btn-lg" href="/claims/RET-260903-031">View demo claim</Link>
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
              <p>A financial-control prototype for reviewable marketplace return reversals on Razorpay Route.</p>
            </div>
            <div className="lp-footer-links" aria-label="Footer links">
              <Link href="/claims">Workbench</Link>
              <Link href="/evaluation">Evaluation</Link>
              <a href="#developers">Engine contract</a>
              <a href="https://razorpay.com/docs/payments/route/" target="_blank" rel="noreferrer">Route docs</a>
            </div>
          </div>
          <div className="lp-footer-status">
            <span><i /> Test mode</span>
            <span>Deterministic demo data</span>
            <span>No live money moves</span>
            <span>Evaluation snapshot available</span>
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
