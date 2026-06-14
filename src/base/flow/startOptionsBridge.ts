import { StartOptionsRequest } from "#types/actions";

type Opener = (request: StartOptionsRequest) => void;

// Module-level bridge so plain-TS flow actions can open the React start-options
// modal without holding a React reference (mirrors globalLogger / shortcutRegistry).
// The React layer (AppInner) registers the opener; flow actions call request().
let opener: Opener | null = null;

export const startOptionsBridge = {
    setOpener(fn: Opener | null): void {
        opener = fn;
    },
    request(req: StartOptionsRequest): void {
        opener?.(req);
    },
};
