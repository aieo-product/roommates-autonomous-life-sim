export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function jitter(value: string, min: number, max: number): number {
  const fraction = hashSeed(value) / 0xffffffff;
  return min + fraction * (max - min);
}
