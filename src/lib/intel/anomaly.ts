/**
 * Anomaly detection (architecture doc §6): robust z-score against the user's
 * OWN baseline — median and MAD over trailing complete months, never a
 * population model. Deterministic and unit-tested; alerts require BOTH a
 * statistical outlier and a material absolute change (tiny categories can't
 * scream), and only increases alert.
 */

export const ANOMALY_Z_THRESHOLD = 3;
export const ANOMALY_MIN_DELTA_MINOR = 10000; // RM 100
export const ANOMALY_MIN_SAMPLES = 4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Robust z via median/MAD (1.4826 scaling); MAD 0 falls back to 10% of median. */
export function robustZ(valueMinor: number, samplesMinor: number[]): number | null {
  if (samplesMinor.length < ANOMALY_MIN_SAMPLES) return null;
  const med = median(samplesMinor);
  const mad = median(samplesMinor.map((s) => Math.abs(s - med)));
  const scale = mad > 0 ? 1.4826 * mad : Math.max(Math.abs(med) * 0.1, 1);
  return (valueMinor - med) / scale;
}

export interface AnomalyVerdict {
  isAnomaly: boolean;
  z: number | null;
  baselineMedianMinor: number;
  deltaMinor: number;
}

export function detectSpendAnomaly(currentMinor: number, historyMinor: number[]): AnomalyVerdict {
  const z = robustZ(currentMinor, historyMinor);
  const baselineMedianMinor = historyMinor.length > 0 ? median(historyMinor) : 0;
  const deltaMinor = currentMinor - baselineMedianMinor;
  return {
    isAnomaly: z !== null && z >= ANOMALY_Z_THRESHOLD && deltaMinor >= ANOMALY_MIN_DELTA_MINOR,
    z,
    baselineMedianMinor,
    deltaMinor,
  };
}
