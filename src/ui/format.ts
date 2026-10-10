/** Credits with two decimals: 1,234.50 */
export function credits(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A bet multiple: 21,100x or 0.25x */
export function multiple(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}x`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
