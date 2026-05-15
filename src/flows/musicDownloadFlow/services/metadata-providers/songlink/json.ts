import fs from 'fs/promises';
import { getCacheDir } from '../../../../../utils/appPaths';


async function ensureCacheDir() {
    try {
        await fs.access(getCacheDir());
    } catch {
        await fs.mkdir(getCacheDir(), { recursive: true });
    }
}

export async function loadJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
    await ensureCacheDir();
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch (err) {
        return defaultValue;
    }
}

export async function saveJsonFile(filePath: string, data: unknown): Promise<void> {
    // await ensureCacheDir();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
