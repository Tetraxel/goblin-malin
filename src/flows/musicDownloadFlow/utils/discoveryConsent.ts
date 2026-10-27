import { globalLogger } from "#base/logger/logger";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { consentBridge } from "#base/bridges/consentBridge";
import { SettingsStore } from "#settings/settingsStore";
import { discoveryServiceRegistry } from "../registries";
import { getMusicSettings } from "../settings";

const logger = globalLogger.createChild({ service: "DiscoveryConsent" });

// Providers declaring `static consent` never run until the user says yes, once. The answer lives in the
// provider's settings: `enabled` (the live switch) + `consentAsked` (so a "no" is not asked again).
//
// Many tasks hit discovery at the same time, so the question is asked once per provider (in-flight
// requests share one promise) and one dialog at a time (the queue).
const inFlight = new Map<string, Promise<boolean>>();
// Dismissed with Esc: not an answer, so nothing is stored, but don't re-ask within this launch.
const dismissedThisSession = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();

/** Providers the user has not yet answered for (declared `consent`, not enabled, never asked). */
export function getUnansweredConsentKeys(): string[] {
    const stored = getMusicSettings().metadata.discoveryProviders;
    const keys: string[] = [];
    for (const [key, ctor] of discoveryServiceRegistry.getAllConstructors()) {
        if (!ctor.consent) continue;
        const s = stored[key];
        if (s?.enabled === true || s?.consentAsked === true || dismissedThisSession.has(key)) continue;
        keys.push(key);
    }
    return keys;
}

function persist(key: string, enabled: boolean): void {
    SettingsStore.getInstance().patchMusicSettings({
        metadata: { discoveryProviders: { [key]: { enabled, consentAsked: true } } },
    });
}

function ask(key: string): Promise<boolean> {
    const consent = discoveryServiceRegistry.getConstructor(key)?.consent;
    if (!consent) return Promise.resolve(false);
    const display = providerDisplayRegistry.get(key);

    return new Promise<boolean>((resolve) => {
        const shown = consentBridge.request({
            providerKey: key,
            label: display.label,
            color: display.color,
            title: consent.title,
            message: consent.message,
            allow: () => {
                logger.info(`User allowed discovery provider '${key}'`);
                persist(key, true);
                resolve(true);
            },
            deny: () => {
                logger.info(`User declined discovery provider '${key}'`);
                persist(key, false);
                resolve(false);
            },
            dismiss: () => {
                logger.info(`Consent dialog for '${key}' dismissed without an answer`);
                dismissedThisSession.add(key);
                resolve(false);
            },
        });
        if (!shown) {
            // Nobody to ask (headless): stay off, store nothing, so a real session still gets asked.
            logger.warn(`No UI available to ask consent for '${key}'; skipping it`);
            resolve(false);
        }
    });
}

/**
 * Resolves true when the provider may be used: already enabled, or the user just allowed it.
 * Resolves false when the user declined/dismissed (now or earlier), or the provider is simply
 * disabled in Settings. Providers without a declared `consent` are not this gate's business.
 */
export function ensureDiscoveryConsent(key: string): Promise<boolean> {
    const ctor = discoveryServiceRegistry.getConstructor(key);
    if (!ctor?.consent) return Promise.resolve(true);

    const stored = getMusicSettings().metadata.discoveryProviders[key];
    if (stored?.enabled === true) return Promise.resolve(true);
    if (stored?.consentAsked === true || dismissedThisSession.has(key)) return Promise.resolve(false);

    const pending = inFlight.get(key);
    if (pending) return pending;

    const promise = queue.then(() => {
        // An earlier dialog (or the Settings screen) may have answered while we were queued.
        const now = getMusicSettings().metadata.discoveryProviders[key];
        if (now?.enabled === true) return true;
        if (now?.consentAsked === true || dismissedThisSession.has(key)) return false;
        return ask(key);
    });
    inFlight.set(key, promise);
    // Never let a failed dialog poison the queue for the providers waiting behind it.
    const settle = () => {
        inFlight.delete(key);
    };
    queue = promise.then(settle, settle);
    return promise;
}
