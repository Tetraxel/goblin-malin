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

export interface StatusAttributes {
    type: StatusType;
    message: string;
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
        a.timeTracking === b.timeTracking &&
        a.stepNumber === b.stepNumber &&
        a.progress === b.progress &&
        a.startTime === b.startTime &&
        a.metadata === b.metadata
    );
}

export class TaskStatus {
    private attributes: StatusAttributes = DEFAULT_ATTRIBUTES;
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

    public clear(): void {
        this.attributes = DEFAULT_ATTRIBUTES;
        this.notifySubscribers();
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
        this.subscribers.forEach((callback) => callback(this.get()));
    }
}
