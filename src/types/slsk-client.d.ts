declare module "slsk-client" {
    export interface SlskFile {
        user: string;
        file: string;
        size: number;
        slots: boolean;
        bitrate?: number;
        speed: number;
    }

    interface DownloadOptions {
        file: SlskFile;
        path: string;
    }

    export interface SoulseekClient {
        search: (
            options: { req: string; timeout?: number },
            callback: (err: Error | null, res: SlskFile[]) => void
        ) => void;
        destroy: () => void;
        download: (options: DownloadOptions, callback: (err: Error | null, data: { buffer: Buffer }) => void) => void;
    }

    export function connect(
        options: { user: string; pass: string },
        callback: (err: Error | null, client: SoulseekClient) => void
    ): void;
}
