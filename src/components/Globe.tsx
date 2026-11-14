export function Globe() {
  return <div className="globe-art" aria-hidden="true">
    <svg viewBox="0 0 420 280" fill="none">
      <defs><clipPath id="sphere"><circle cx="226" cy="137" r="105" /></clipPath><radialGradient id="wash"><stop stopColor="#e9eddf" /><stop offset="1" stopColor="#dce3d1" /></radialGradient></defs>
      <path d="M34 242H408M226 14v248" stroke="#cbd2c1" strokeDasharray="3 5" />
      <circle cx="226" cy="137" r="105" fill="url(#wash)" stroke="#9aa98d" />
      <g clipPath="url(#sphere)" stroke="#b7c4aa" strokeWidth=".7">
        {[30, 58, 82].map(r => <ellipse key={r} cx="226" cy="137" rx={r} ry="105" />)}
        {[64, 101, 137, 174, 211].map(y => <ellipse key={y} cx="226" cy={y} rx="105" ry="22" />)}
        <path d="m143 74 18-9 14 7 16-9 23 10 5 15-11 8-1 16-16 9-5 14-15-3-7-12-12-6-5-19-15-8Zm49 62 15 7 10-2 15 18-2 16-11 15-4 23-12 12-7-18-3-20-9-17-1-17Zm74-95 16 17 29 9 12 18-13 9-5 18-22 4-10-12-16-2-12-17 5-14Zm-9 86 23-7 20 10 12 28-8 13-7 29-17 9-8-18-3-23-16-17Z" fill="#99ae8b" stroke="#819c71" strokeWidth="1.2" />
        <path d="m150 78 19 5 17-7 19 6m-51 12 21 4 19-9m-29 19 17 3 14-10m-4 49 13 8 11-3m-19 14 16 8m-14 9 11 9m54-61 20 9 21-2m-35 8 17 10 17-3m-31 10 15 11 11-3m-26 7 12 10m-10-115 27 8m-35 1 34 9m-37 1 25 7" stroke="#638158" />
      </g>
      <ellipse cx="226" cy="137" rx="164" ry="50" transform="rotate(-27 226 137)" stroke="#6d8568" strokeWidth=".8" />
      <circle cx="151" cy="124" r="5" fill="#dd754b" stroke="#fffdf7" strokeWidth="3" />
      <path d="m151 124-63 14v35H52" stroke="#b57855" strokeWidth=".8" />
      <text x="34" y="190" fill="#6f8069" fontSize="9" fontFamily="Manrope">14.07° N / 87.19° W</text>
      <circle cx="341" cy="74" r="4" fill="#274e3f" />
      <text x="270" y="261" fill="#83917a" fontSize="8" letterSpacing="2" fontFamily="Manrope">ONE PLANET. MANY SIGNALS.</text>
    </svg>
  </div>;
}
