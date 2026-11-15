import { notificationScheduler } from "../notificationScheduler";

export enum StatusType {
    Default = "default",
    Processing = "processing",
    Pending = "pending",
    PendingUserAction = "pendingUserAction",
    Locked = "locked",
    Skipped = "skipped",
    Error = "error",
    Success = "success",
    NoStatus = "noStatus",
}

// Lets a status ask for a specific animated icon instead of the one its type implies.
// "agent": an AI agent is working on the task (shown as the · ✢ ✳ ✶ ✻ ✽ spinner).
export type StatusIcon = "agent";

export interface StatusAttributes {
    type: StatusType;
    message: string;
    icon?: StatusIcon;
    // Brand color for the icon (e.g. the provider doing the work); falls back to the icon's own.
    iconColor?: string;
    timeTracking?: boolean;
    stepNumber?: number;
    progress?: number;
    startTime?: Date | null;
    metadata?: Record<string, unknown>;
}

const DEFAULT_ATTRIBUTES: StatusAttributes = {
    type: StatusType.NoStatus,
    message: "No status",
    timeTracking: false,
    stepNumber: undefined,
    progress: undefined,
    startTime: undefined,
    metadata: undefined,
};

function statusEqual(a: StatusAttributes, b: StatusAttributes): boolean {
    return (
        a.type === b.type &&
        a.message === b.message &&
        a.icon === b.icon &&
        a.iconColor === b.iconColor &&
        a.timeTracking === b.timeTracking &&
        a.stepNumber === b.stepNumber &&
        a.progress === b.progress &&
        a.startTime === b.startTime &&
        a.metadata === b.metadata
    );
}

export class TaskStatus {
    private attributes: StatusAttributes = DEFAULT_ATTRIBUTES;
    // The label of each stage going on (see setFallback), oldest first.
    private fallbacks = new Map<string, StatusAttributes>();
    private subscribers: Set<(status: StatusAttributes, elapsed?: number) => void> = new Set();

    constructor(initialStatus: StatusAttributes = DEFAULT_ATTRIBUTES) {
        this.set(initialStatus);
    }

    public get(): StatusAttributes {
        return { ...this.attributes };
    }

    // Replace all status attributes
    public set(status: StatusAttributes = DEFAULT_ATTRIBUTES): StatusAttributes {
        const prev = this.attributes;
        this.attributes = DEFAULT_ATTRIBUTES;
        return this.update(status, prev);
    }

    // Update partial status attributes
    public update(
        partial: Partial<StatusAttributes> = DEFAULT_ATTRIBUTES,
        // Attributes to diff against for the change check. Defaults to the current
        // attributes; `set()` passes the pre-reset ones so a replace is still diffed
        // against the real previous state.
        prevForCompare: StatusAttributes = this.attributes
    ): StatusAttributes {
        const wasTracking = this.attributes.timeTracking;

        const next: StatusAttributes = {
            ...this.attributes,
            ...partial,
        };

        // Start tracking if enabled
        if (partial.timeTracking && !wasTracking) {
            next.startTime = new Date();
        }

        // Stop tracking if disabled
        if (partial.timeTracking === false) {
            next.startTime = null;
        }

        this.attributes = next;

        // Skip the notification (and the React commit + Ink full-tree repaint it
        // triggers) when nothing visible changed. Download progress fires many
        // identical updates per second once quantized to integer percent — this
        // collapses them to at most one commit per actual change.
        if (!statusEqual(prevForCompare, next)) {
            this.notifySubscribers();
        }
        return this.attributes;
    }

    /** The stage shown when nobody says otherwise: the one that named itself last (see {@link setFallback}). */
    private currentFallback(): StatusAttributes | undefined {
        let last: StatusAttributes | undefined;
        for (const fallback of this.fallbacks.values()) last = fallback;
        return last;
    }

    /** Back to what the task shows when nobody says otherwise: the stage it is in (see {@link setFallback}), else nothing. */
    public clear(): void {
        this.attributes = this.currentFallback() ?? DEFAULT_ATTRIBUTES;
        this.notifySubscribers();
    }

    /**
     * What to show while a stage is going on and no service is reporting anything: the services set and clear their
     * own status (`Searching Spotify`…) one after the other, so between two of them the row would say "No status"
     * while the task is still working. The stage names itself here, and the services' statuses show over it. Pass
     * `undefined` when the stage ends: if the row still shows it, the stage still going (if any) shows instead,
     * else it is cleared.
     *
     * Stages are told apart by `stage`: two of them can overlap on one track (a re-discovery started while a
     * download runs), and the end of one must not take the other's label away. Starting a stage again replaces its
     * own label.
     */
    public setFallback(stage: string, fallback: StatusAttributes | undefined): void {
        const previous = this.fallbacks.get(stage);
        // Re-inserted, so the stage that began last is the last one of the map.
        this.fallbacks.delete(stage);
        if (fallback) {
            const next = { ...fallback, startTime: fallback.timeTracking ? new Date() : fallback.startTime };
            this.fallbacks.set(stage, next);
            // Shown when the row says nothing, or is still showing a stage's label (the newest stage wins it).
            if (
                this.attributes.type === StatusType.NoStatus ||
                this.attributes === previous ||
                this.isStageLabel(this.attributes)
            ) {
                this.attributes = next;
                this.notifySubscribers();
            }
        } else if (previous && this.attributes === previous) {
            this.clear();
        }
    }

    private isStageLabel(attributes: StatusAttributes): boolean {
        for (const fallback of this.fallbacks.values()) if (fallback === attributes) return true;
        return false;
    }

    // Subscribe to status changes
    public subscribe(callback: (status: StatusAttributes) => void): () => void {
        this.subscribers.add(callback);
        // Send current status immediately
        callback(this.get());

        // Return unsubscribe function
        return () => {
            this.subscribers.delete(callback);
        };
    }

    private notifySubscribers(): void {
        // Coalesced to one flush per frame (see notificationScheduler). Progress ticks
        // and other rapid status changes collapse to a single commit per frame.
        notificationScheduler.schedule(this.emitToSubscribers);
    }

    private emitToSubscribers = (): void => {
        const snapshot = this.get();
        this.subscribers.forEach((callback) => callback(snapshot));
    };
}
