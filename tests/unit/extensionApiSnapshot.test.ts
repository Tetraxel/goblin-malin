import { expect, test } from "vitest";
import { committedApiShape, currentApiShape } from "../../scripts/extensionApiShape";

/**
 * Every member of the extension API is a promise to extension authors (P34). A change of
 * src/extensions/api/types.ts must be deliberate: refresh docs/extension-api.snapshot.d.ts with
 * `yarn run extension-api --write`, and bump EXTENSION_API_VERSION (#constants) when the change breaks an extension
 * written for the current version (a member removed or renamed, a parameter that became required…).
 */
test("the committed extension API snapshot matches src/extensions/api/types.ts", async () => {
    const committed = await committedApiShape();
    expect(
        committed,
        "docs/extension-api.snapshot.d.ts is missing: run `yarn run extension-api --write`"
    ).toBeDefined();
    expect(
        committed,
        "The extension API changed: run `yarn run extension-api --write`, and bump EXTENSION_API_VERSION if this breaks extensions"
    ).toBe(await currentApiShape());
});
