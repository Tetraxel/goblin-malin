declare module "flac-tagger" {
    export type FlacTagMap = Record<string, string[] | string>;

    export interface FlacTags {
        tagMap: FlacTagMap;
        picture?: {
            pictureType?: number;
            mime?: string;
            description?: string;
            colorDepth?: number;
            colors?: number;
            buffer: Buffer;
        };
    }

    export const readFlacTagsSync: (input: string | Buffer) => FlacTags;
    export const readFlacTags: (input: string | Buffer) => Promise<FlacTags>;
    export const writeFlacTagsSync: (tags: FlacTags, filePath: string) => void;
    export const writeFlacTags: (tags: FlacTags, filePath: string) => Promise<void>;
}
