
export enum StatusType {
    Default = "default",
    Processing = "processing",
    Pending = "pending",
    PendingUserAction = "pendingUserAction",
    Locked = "locked",
    Skipped = "skipped",
    Error = "error",
    Success = "success",
    NoStatus = "noStatus"
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
        this.attributes = DEFAULT_ATTRIBUTES;
        return this.update(status);
    }

    // Update partial status attributes
    public update(partial: Partial<StatusAttributes> = DEFAULT_ATTRIBUTES): StatusAttributes {
        const wasTracking = this.attributes.timeTracking;

        this.attributes = {
            ...this.attributes,
            ...partial,
        };

        // Start tracking if enabled
        if (partial.timeTracking && !wasTracking) {
            this.attributes.startTime = new Date();
        }

        // Stop tracking if disabled
        if (partial.timeTracking === false) {
            this.attributes.startTime = null;
        }

        this.notifySubscribers();
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
        this.subscribers.forEach(callback =>
            callback(this.get())
        );
    }
}
