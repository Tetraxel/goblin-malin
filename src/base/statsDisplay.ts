type Subscriber = (enabled: boolean) => void;

class StatsDisplayStore {
    private enabled = false;
    private subscribers = new Set<Subscriber>();

    toggle(): void {
        this.enabled = !this.enabled;
        this.subscribers.forEach((fn) => fn(this.enabled));
    }

    get(): boolean {
        return this.enabled;
    }

    subscribe(fn: Subscriber): () => void {
        this.subscribers.add(fn);
        return () => this.subscribers.delete(fn);
    }
}

export const statsDisplay = new StatsDisplayStore();
