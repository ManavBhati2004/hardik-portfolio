// Adaptive quality: three tiers, asymmetric hysteresis. Downgrade fast (one bad window),
// upgrade slowly (several healthy windows in a row) — otherwise the tier flaps every second
// and the resolution change itself causes the next stutter.

export const TIERS = [
  { name: "Eco",      pixelRatio: 0.85, msaa: 0, bloom: false, shadows: false, planetOctaves: 0 },
  { name: "Balanced", pixelRatio: 1.15, msaa: 2, bloom: true,  shadows: true,  planetOctaves: 1 },
  { name: "High",     pixelRatio: 1.75, msaa: 4, bloom: true,  shadows: true,  planetOctaves: 1 },
];

const WINDOW = 90;           // frames per evaluation window
const SLOW_MS = 23;          // p75 above this -> downgrade now
const HEALTHY_MS = 18;       // p75 below this for UPGRADE_AFTER windows -> upgrade
const UPGRADE_AFTER = 5;

export function createQualityGovernor({ initial = 2, locked = false, onChange }) {
  const samples = new Float32Array(WINDOW);
  let n = 0, tier = initial, healthy = 0;
  return {
    get tier() { return tier; },
    get settings() { return TIERS[tier]; },
    /** Feed real frame intervals only (skip frames after pauses / tab switches). */
    sample(ms) {
      if (locked || ms <= 0 || ms > 250) return;
      samples[n++] = ms;
      if (n < WINDOW) return;
      n = 0;
      const p75 = [...samples].sort((a, b) => a - b)[Math.floor(WINDOW * 0.75)];
      let next = tier;
      if (p75 > SLOW_MS && tier > 0) { next = tier - 1; healthy = 0; }
      else if (p75 < HEALTHY_MS && tier < TIERS.length - 1 && ++healthy >= UPGRADE_AFTER) { next = tier + 1; healthy = 0; }
      else if (p75 >= HEALTHY_MS) healthy = 0;
      if (next !== tier) { tier = next; onChange?.(TIERS[tier], p75); }
    },
    reset() { n = 0; },
  };
}

/** Start tier from cheap device hints — mobile GPUs begin at Balanced, not High. */
export function initialTier() {
  const mobile = matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile || cores <= 4) return 1;
  return 2;
}
