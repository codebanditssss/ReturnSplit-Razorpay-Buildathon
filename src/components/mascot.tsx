/* Split - the ReturnSplit ledger mascot. Flat brand illustration, paper-on-green. */
export function Mascot({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 132 116" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Split, the ReturnSplit mascot, holding a balanced receipt">
      <ellipse cx="60" cy="105" rx="46" ry="8" fill="#0b3a2a" opacity=".32" />
      {/* receipt in hand */}
      <g transform="rotate(8 101 54)">
        <rect x="86" y="30" width="30" height="46" rx="4" fill="#ffffff" stroke="#cfe0d7" strokeWidth="1.4" />
        <path d="M90 40h22M90 47h22M90 54h14" stroke="#b9d5c9" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="101" cy="64" r="6" fill="#eaf3ef" />
        <path d="M98 64l2.3 2.4L104 61.4" stroke="#176247" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d="M77 66c8 2 14-2 18-8" stroke="#dfece6" strokeWidth="7" strokeLinecap="round" />
      {/* head tag */}
      <path d="M54 27v-7" stroke="#dfece6" strokeWidth="3" strokeLinecap="round" />
      <circle cx="54" cy="16" r="4" fill="#8fd0b7" />
      {/* body */}
      <rect x="24" y="26" width="60" height="66" rx="20" fill="#f4f7f4" stroke="#d3e2da" strokeWidth="1.5" />
      <rect x="35" y="58" width="38" height="26" rx="10" fill="#eaf3ef" />
      {/* split-tag emblem */}
      <g transform="rotate(-10 54 71)">
        <rect x="47" y="63" width="6" height="16" rx="2.2" fill="#8fd0b7" />
        <rect x="54" y="63" width="6" height="16" rx="2.2" fill="#176247" />
      </g>
      {/* face */}
      <circle cx="44" cy="46" r="4.4" fill="#123f2e" />
      <circle cx="64" cy="46" r="4.4" fill="#123f2e" />
      <circle cx="37" cy="54" r="3.2" fill="#f6c6a8" opacity=".5" />
      <circle cx="71" cy="54" r="3.2" fill="#f6c6a8" opacity=".5" />
      <path d="M47 53q7 6 14 0" stroke="#123f2e" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* feet */}
      <rect x="36" y="90" width="12" height="8" rx="4" fill="#dfece6" />
      <rect x="60" y="90" width="12" height="8" rx="4" fill="#dfece6" />
    </svg>
  );
}
