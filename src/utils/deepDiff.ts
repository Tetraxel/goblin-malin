import { DeepPartial } from "./types";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export function deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const keys = Object.keys(a);
        return keys.length === Object.keys(b).length && keys.every((k) => k in b && deepEqual(a[k], b[k]));
    }
    return false;
}

/**
 * The part of `value` that differs from `defaults`, i.e. the inverse of `deepMerge(defaults, diff) === value`.
 * Persisting only this keeps defaults out of the user's file, so a default changed in a later release still
 * reaches everyone who ever saved a setting. Arrays and primitives are compared whole; keys that only exist
 * in `defaults` are left out (a merge restores them). Returns `undefined` when nothing differs.
 */
export function deepDiff<T>(defaults: T, value: T): DeepPartial<T> | undefined {
    if (deepEqual(defaults, value)) return undefined;
    if (isPlainObject(defaults) && isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
            const changed = deepDiff(defaults[key], value[key]);
            if (changed !== undefined) out[key] = changed;
        }
        return Object.keys(out).length > 0 ? (out as DeepPartial<T>) : undefined;
    }
    return value as DeepPartial<T>;
}
