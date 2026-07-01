import React from "react";
import { Key } from "ink";
import { Shortcut, matchesShortcut, getShortcutLiteral } from "#types/actions";
import { cache } from "#utils/cache";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ShortcutEntry {
    id: string;
    defaultShortcut: Shortcut;
    /** Resolved binding — may differ from default if user has remapped it. */
    shortcut: Shortcut;
    label: string;
    handler: () => void | Promise<void>;
}

export type HintLineLeft =
    | { type: "text"; value: string; color?: string; bold?: boolean }
    | { type: "node"; renderNode: (dimmed: boolean) => React.ReactNode; nodeKey: string };

export interface HintLineEntry {
    id: string;
    left: HintLineLeft;
    shortcutIds: string[];
}

export interface ActiveHintContext {
    contextId: string;
    priority: number;
    lines: HintLineEntry[];
    shortcuts: ShortcutEntry[];
}

export type RebindCallback = (input: string, key: Key) => void;

// ── Stub persistence ──────────────────────────────────────────────────────────

interface ShortcutStub {
    id: string;
    label: string;
    defaultShortcut: Shortcut;
    contextId: string;
    priority: number;
}

const STUBS_CACHE_KEY = "shortcutRegistry.stubs";

// ── Internal ──────────────────────────────────────────────────────────────────

interface ContextRegistration {
    contextId: string;
    priority: number;
    isActive: boolean;
    /** When true, blocks lower-priority contexts even when no shortcut matches. */
    exclusive: boolean;
    shortcuts: ShortcutEntry[];
    hintLines: HintLineEntry[];
}

type Subscriber = () => void;

// ── Registry class ────────────────────────────────────────────────────────────

class ShortcutRegistryClass {
    private contexts = new Map<string, ContextRegistration>();
    private subscribers = new Set<Subscriber>();
    private lastHintViewKey = "";
    private rebindCallback: RebindCallback | null = null;
    private knownStubs = new Map<string, ShortcutStub>(
        ((cache.get(STUBS_CACHE_KEY) as ShortcutStub[] | undefined) ?? []).map((s) => [s.id, s])
    );

    private persistStubs(contextId: string, priority: number, shortcuts: ShortcutEntry[]): void {
        let dirty = false;
        for (const entry of shortcuts) {
            const prev = this.knownStubs.get(entry.id);
            const literal = getShortcutLiteral([entry.defaultShortcut]);
            if (
                !prev ||
                prev.label !== entry.label ||
                prev.contextId !== contextId ||
                getShortcutLiteral([prev.defaultShortcut]) !== literal
            ) {
                this.knownStubs.set(entry.id, {
                    id: entry.id,
                    label: entry.label,
                    defaultShortcut: entry.defaultShortcut,
                    contextId,
                    priority,
                });
                dirty = true;
            }
        }
        if (dirty) {
            cache.set(STUBS_CACHE_KEY, [...this.knownStubs.values()]);
            cache.save();
        }
    }

    /**
     * Register a shortcut context. Returns an unregister function.
     * Should be called on component mount and cleaned up on unmount.
     */
    register(
        contextId: string,
        shortcuts: ShortcutEntry[],
        hintLines: HintLineEntry[],
        isActive: boolean,
        priority: number,
        exclusive = false
    ): () => void {
        this.contexts.set(contextId, { contextId, priority, isActive, exclusive, shortcuts, hintLines });
        this.persistStubs(contextId, priority, shortcuts);
        this.maybeNotify();
        return () => {
            this.contexts.delete(contextId);
            this.maybeNotify();
        };
    }

    /** Update an existing context registration (called every render). */
    update(contextId: string, shortcuts: ShortcutEntry[], hintLines: HintLineEntry[], isActive: boolean): void {
        const ctx = this.contexts.get(contextId);
        if (!ctx) return;
        // Always update handlers (so dispatch always uses the latest closures)
        this.contexts.set(contextId, { ...ctx, shortcuts, hintLines, isActive });
        this.persistStubs(contextId, ctx.priority, shortcuts);
        this.maybeNotify();
    }

    /** Intercept all key events for one-shot rebind capture. Call disableRebind() inside the callback when done. */
    enableRebind(callback: RebindCallback): void {
        this.rebindCallback = callback;
    }

    disableRebind(): void {
        this.rebindCallback = null;
    }

    /**
     * Dispatch a key event through all active registered contexts.
     * Consume model: highest-priority active handler that matches fires; traversal stops.
     * Exclusive contexts block lower-priority contexts even when no shortcut matches.
     */
    dispatch(input: string, key: Key): void {
        if (this.rebindCallback) {
            this.rebindCallback(input, key);
            return;
        }

        const sorted = [...this.contexts.values()]
            .filter((ctx) => ctx.isActive)
            .sort((a, b) => b.priority - a.priority);

        for (const ctx of sorted) {
            for (const entry of ctx.shortcuts) {
                if (matchesShortcut(entry.shortcut, input, key)) {
                    try {
                        void entry.handler();
                    } catch (err) {
                        console.error(`[shortcuts] unhandled error in ${ctx.contextId}.${entry.id}:`, err);
                    }
                    return;
                }
            }
            if (ctx.exclusive) return;
        }
    }

    /**
     * Dispatch a function key (F1–F12) through active contexts.
     * Called by ShortcutDispatcher's raw stdin listener because Ink zeroes `input`
     * for function keys before delivering it to useInput handlers.
     */
    dispatchFuncKey(funcKeyNum: number): void {
        if (this.rebindCallback) return;

        const sorted = [...this.contexts.values()]
            .filter((ctx) => ctx.isActive)
            .sort((a, b) => b.priority - a.priority);

        for (const ctx of sorted) {
            for (const entry of ctx.shortcuts) {
                if (entry.shortcut.funcKey === funcKeyNum) {
                    try {
                        void entry.handler();
                    } catch (err) {
                        console.error(`[shortcuts] unhandled error in ${ctx.contextId}.${entry.id}:`, err);
                    }
                    return;
                }
            }
            if (ctx.exclusive) return;
        }
    }

    unregister(contextId: string): void {
        if (this.contexts.has(contextId)) {
            this.contexts.delete(contextId);
            this.maybeNotify();
        }
    }

    hasContext(contextId: string): boolean {
        return this.contexts.has(contextId);
    }

    /**
     * Returns the default binding for a shortcut id, searching live contexts first
     * (most up-to-date) and falling back to persisted stubs so hints resolve even
     * when the owning context is not currently mounted. Callers apply any user
     * override on top (see useShortcutLiteral).
     */
    getDefaultShortcut(id: string): Shortcut | undefined {
        for (const ctx of this.contexts.values()) {
            const entry = ctx.shortcuts.find((s) => s.id === id);
            if (entry) return entry.defaultShortcut;
        }
        return this.knownStubs.get(id)?.defaultShortcut;
    }

    /**
     * Returns active hint contexts sorted by priority descending (highest = most specific = first).
     */
    getActiveHintContexts(): ActiveHintContext[] {
        return [...this.contexts.values()]
            .filter((ctx) => ctx.isActive && ctx.hintLines.length > 0)
            .sort((a, b) => b.priority - a.priority)
            .map((ctx) => ({
                contextId: ctx.contextId,
                priority: ctx.priority,
                lines: ctx.hintLines,
                shortcuts: ctx.shortcuts,
            }));
    }

    /**
     * Returns all registered shortcut entries (for the Settings > Shortcuts tab).
     */
    getAllEntries(): Array<{ contextId: string; priority: number; entry: ShortcutEntry }> {
        const result: Array<{ contextId: string; priority: number; entry: ShortcutEntry }> = [];
        const liveIds = new Set<string>();
        for (const ctx of this.contexts.values()) {
            for (const entry of ctx.shortcuts) {
                liveIds.add(entry.id);
                result.push({ contextId: ctx.contextId, priority: ctx.priority, entry });
            }
        }
        for (const stub of this.knownStubs.values()) {
            if (!liveIds.has(stub.id)) {
                result.push({
                    contextId: stub.contextId,
                    priority: stub.priority,
                    entry: {
                        id: stub.id,
                        label: stub.label,
                        defaultShortcut: stub.defaultShortcut,
                        shortcut: stub.defaultShortcut,
                        handler: () => {},
                    },
                });
            }
        }
        return result;
    }

    subscribe(fn: Subscriber): () => void {
        this.subscribers.add(fn);
        return () => this.subscribers.delete(fn);
    }

    private buildHintViewKey(): string {
        return [...this.contexts.values()]
            .filter((ctx) => ctx.isActive)
            .sort((a, b) => b.priority - a.priority)
            .map((ctx) => {
                const linesKey = ctx.hintLines
                    .map((l) => {
                        // Include left content so hint bar re-renders when URI/position changes.
                        const leftKey = l.left.type === "node" ? `node:${l.left.nodeKey}` : `text:${l.left.value}`;
                        return `${l.id}:${leftKey}:[${l.shortcutIds.join(",")}]`;
                    })
                    .join(";");
                const shortcutsKey = ctx.shortcuts.map((s) => `${s.id}=${getShortcutLiteral([s.shortcut])}`).join(",");
                return `${ctx.contextId}(${shortcutsKey})(${linesKey})`;
            })
            .join("|");
    }

    /** Only call subscribers when the visible hint view actually changes. */
    private maybeNotify(): void {
        const newKey = this.buildHintViewKey();
        if (newKey !== this.lastHintViewKey) {
            this.lastHintViewKey = newKey;
            this.subscribers.forEach((fn) => fn());
        }
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const shortcutRegistry = new ShortcutRegistryClass();

// ── React context / provider ──────────────────────────────────────────────────

const ShortcutRegistryContext = React.createContext<ShortcutRegistryClass>(shortcutRegistry);

export const ShortcutRegistryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    React.createElement(ShortcutRegistryContext.Provider, { value: shortcutRegistry }, children);

export function useShortcutRegistry(): ShortcutRegistryClass {
    return React.useContext(ShortcutRegistryContext);
}
