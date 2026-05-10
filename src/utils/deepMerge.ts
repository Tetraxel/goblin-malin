import { DeepPartial } from './types';

export function deepMerge<T>(target: T, source: DeepPartial<T>): T {
  if (typeof source !== 'object' || source === null) return source as unknown as T;
  if (typeof target !== 'object' || target === null) return source as unknown as T;

  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const key of Object.keys(source as Record<string, unknown>)) {
    const srcVal = (source as Record<string, unknown>)[key];
    const tgtVal = (target as Record<string, unknown>)[key];
    if (srcVal !== undefined) {
      if (
        typeof srcVal === 'object' && srcVal !== null && !Array.isArray(srcVal) &&
        typeof tgtVal === 'object' && tgtVal !== null && !Array.isArray(tgtVal)
      ) {
        result[key] = deepMerge(tgtVal, srcVal as DeepPartial<typeof tgtVal>);
      } else {
        result[key] = srcVal;
      }
    }
  }
  return result as T;
}
