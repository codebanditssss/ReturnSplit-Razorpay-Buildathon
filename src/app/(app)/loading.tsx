export default function Loading() {
  return (
    <div className="page" aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">Loading workspace…</span>
      <div className="skeleton-header" aria-hidden="true">
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-copy" />
      </div>
      <div className="workbench-grid" aria-hidden="true">
        <div className="card skeleton-rows">
          {Array.from({ length: 5 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton skeleton-cell-wide" /><span className="skeleton skeleton-cell" /><span className="skeleton skeleton-cell" /></div>)}
        </div>
        <div className="card skeleton-rows">
          {Array.from({ length: 3 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton skeleton-cell-wide" /><span className="skeleton skeleton-cell" /></div>)}
        </div>
      </div>
    </div>
  );
}
