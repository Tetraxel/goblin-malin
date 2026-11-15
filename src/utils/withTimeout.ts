/**
 * Rejects with `Error(message)` when `promise` has not settled within `ms`. The work behind the promise is not
 * cancelled (a promise cannot be): its late result is simply ignored.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = "took too long"): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        timer.unref?.();
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}
