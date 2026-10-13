import { BATTLE } from '../battle/logic';

/** In Battle mode every amount shown is a win in points (a bet of 1 pays `pointsPerBet` points per credit won). */
let pointsMode = false;
export function setPointsMode(on: boolean): void {
  pointsMode = on;
}

export const isPointsMode = (): boolean => pointsMode;

/** Credits with two decimals: 1,234.50. In Battle mode: whole points, like 1,235 pts. */
export function credits(value: number): string {
  if (pointsMode) return `${Math.round(value * BATTLE.pointsPerBet).toLocaleString('en-US')} pts`;
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A bet multiple: 21,100x or 0.25x */
export function multiple(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}x`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
