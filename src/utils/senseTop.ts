// Utility to sense a top in pool price action
// Usage: Call senseTop with an array of recent price/profit % values (most recent last)
// Returns true if a top/plateau is detected, false otherwise

// === Easy-to-adjust parameters ===
export const DEFAULT_PLATEAU_WINDOW = 3; // How many consecutive updates to check for plateau
export const DEFAULT_PLATEAU_THRESHOLD_PCT = 1; // How close to the max profit % counts as plateau
export const DEFAULT_VOLATILITY_THRESHOLD_PCT = 3; // What % swing counts as high volatility
export const DEFAULT_MIN_PROFITS_ABOVE_PCT = 10; // Minimum profit % to consider for plateau
export const DEFAULT_MIN_PLATEAU_COUNT = 2; // Minimum number of profits above threshold within plateau
// =================================

export interface TopSenseOptions {
  plateauWindow?: number;
  plateauThresholdPct?: number;
  minProfitsAbovePct?: number;
  minPlateauCount?: number;
}

export function senseTop(
  profitHistory: number[], // Array of profit % (most recent last)
  options: TopSenseOptions = {}
): boolean {
  const {
    plateauWindow = DEFAULT_PLATEAU_WINDOW,
    plateauThresholdPct = DEFAULT_PLATEAU_THRESHOLD_PCT,
    minProfitsAbovePct = DEFAULT_MIN_PROFITS_ABOVE_PCT,
    minPlateauCount = DEFAULT_MIN_PLATEAU_COUNT,
  } = options;
  if (profitHistory.length < plateauWindow) return false;

  // Only consider the last N profits
  const recent = profitHistory.slice(-plateauWindow);
  // Find all profits above threshold
  const above = recent.filter(p => p >= minProfitsAbovePct);
  if (above.length < minPlateauCount) return false;
  // Check if all above-threshold profits are within plateauThresholdPct of each other
  const max = Math.max(...above);
  const min = Math.min(...above);
  if (Math.abs(max - min) <= plateauThresholdPct) {
    return true;
  }
  return false;
} 