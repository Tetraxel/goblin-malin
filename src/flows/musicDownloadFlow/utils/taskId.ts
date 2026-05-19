import { createHash } from "crypto";

export function taskIdFromUrl(url: string): string {
    return "task:" + createHash("sha1").update(url).digest("hex").slice(0, 12);
}
