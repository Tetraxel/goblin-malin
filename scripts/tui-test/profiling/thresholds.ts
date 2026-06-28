import type { Thresholds } from "./types.ts";

// Defaults are tuned for dev-mode (`tsx`) timings on developer hardware, where
// absolute ms run higher than a built binary. Treat ms-based limits as advisory
// (they emit `warn`); the count-based commits-per-interaction limit is the only
// machine-independent hard signal (`error`). Override per scenario via
// `scenario.profile.thresholds`.
export const DEFAULT_THRESHOLDS: Thresholds = {
    maxCommitDurationMs: 20,
    maxCommitsPerInteraction: 12,
    maxInteractionReactMs: 60,
    maxComponentSelfMsP95: 12,
    // App-component parent-only re-renders per interaction (Ink primitives are
    // excluded — they cannot be memoized). ~0 in a well-memoized app today, so a
    // new non-memoized component that re-renders broadly will surface here.
    maxWastedRendersPerInteraction: 40,
};

export function resolveThresholds(overrides?: Partial<Thresholds>): Thresholds {
    return { ...DEFAULT_THRESHOLDS, ...(overrides ?? {}) };
}
