/**
 * The launcher's mark: an angular Strogg plate with a cut corner and the two
 * bars of "II".
 *
 * Drawn rather than shipped as an asset, so it scales, recolours with the theme
 * and adds nothing to the bundle. Deliberately not a copy of the Quake II logo -
 * that artwork is id Software's.
 */
export function Q2Mark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
    >
      {/* Outer plate: octagon with two deeper chamfers on the diagonal. */}
      <path
        d="M9 2h14l7 7v14l-7 7H9l-7-7V9z"
        fill="url(#q2-plate)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Inset bevel, catching light from the top-left. */}
      <path
        d="M10 5.5h12l4.5 4.5v12L22 26.5H10L5.5 22V10z"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1"
      />
      {/* The "II". */}
      <rect x="12" y="10" width="2.75" height="12" fill="currentColor" />
      <rect x="17.25" y="10" width="2.75" height="12" fill="currentColor" />

      <defs>
        <linearGradient id="q2-plate" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1c1e23" />
          <stop offset="0.55" stopColor="#121317" />
          <stop offset="1" stopColor="#0b0c0e" />
        </linearGradient>
      </defs>
    </svg>
  )
}
