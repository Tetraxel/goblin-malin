import * as os from 'os';
import * as path from 'path';

export interface SaveSettings {
    outputDir: string;
    includeMusicBrainzTags: boolean;
}

export function getDefaultSaveSettings(): SaveSettings {
    return {
        outputDir: process.env.OUTPUT_DIR ?? path.join(os.homedir(), 'Music'),
        includeMusicBrainzTags: false,
    };
}

// P7 will replace this with a real reader:
export function getSaveSettings(): SaveSettings {
    return getDefaultSaveSettings();
}
