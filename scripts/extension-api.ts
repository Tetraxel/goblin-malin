import fs from "node:fs/promises";
import { API_SNAPSHOT_PATH, committedApiShape, currentApiShape } from "./extensionApiShape";

/**
 * The extension API's shape (P34).
 *
 *   yarn run extension-api           says whether docs/extension-api.snapshot.d.ts is up to date
 *   yarn run extension-api --write   refreshes it (after a deliberate change of src/extensions/api/types.ts)
 */
const shape = await currentApiShape();
if (process.argv.includes("--write")) {
    await fs.writeFile(API_SNAPSHOT_PATH, shape, "utf8");
    console.log(`Wrote ${API_SNAPSHOT_PATH}`);
} else if ((await committedApiShape()) === shape) {
    console.log("The extension API snapshot is up to date.");
} else {
    console.log(
        "The extension API changed: run `yarn run extension-api --write` (and bump EXTENSION_API_VERSION if it breaks extensions)."
    );
    process.exitCode = 1;
}
