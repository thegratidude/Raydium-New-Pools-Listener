// Utility to sense a top in pool price action
// Usage: Call senseTop with an array of recent price/profit % values (most recent last)
// Returns true if a top/plateau is detected, false otherwise

// === Easy-to-adjust parameters ===
export const DEFAULT_PLATEAU_WINDOW = 3; // How many consecutive updates to check for plateau
export const DEFAULT_PLATEAU_THRESHOLD_PCT = 1; // How close to the max profit % counts as plateau
export const DEFAULT_VOLATILITY_THRESHOLD_PCT = 3; // What % swing counts as high volatility
// =================================

export interface TopSenseOptions {
  plateauWindow?: number;
  plateauThresholdPct?: number;
  volatilityThresholdPct?: number;
}

export function senseTop(
  profitHistory: number[], // Array of profit % (most recent last)
  options: TopSenseOptions = {}
): boolean {
  const {
    plateauWindow = DEFAULT_PLATEAU_WINDOW,
    plateauThresholdPct = DEFAULT_PLATEAU_THRESHOLD_PCT,
    volatilityThresholdPct = DEFAULT_VOLATILITY_THRESHOLD_PCT,
  } = options;
  if (profitHistory.length < plateauWindow + 1) return false;

  // 1. Plateau detection: last N values are within X% of the max
  const recent = profitHistory.slice(-plateauWindow);
  const maxProfit = Math.max(...profitHistory);
  const plateau = recent.every(p => Math.abs(p - maxProfit) <= plateauThresholdPct);
  if (plateau) return true;

  // 2. Volatility detection: recent swings exceed threshold
  for (let i = profitHistory.length - plateauWindow; i < profitHistory.length - 1; i++) {
    if (Math.abs(profitHistory[i + 1] - profitHistory[i]) >= volatilityThresholdPct) {
      return true;
    }
  }

  // 3. Decline after plateau: new high, then drop
  if (profitHistory[profitHistory.length - 2] === maxProfit &&
      profitHistory[profitHistory.length - 1] < maxProfit - plateauThresholdPct) {
    return true;
  }

  return false;
} 