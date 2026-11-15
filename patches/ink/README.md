# Patched Ink output stage

`output.js` and `render-node-to-output.js` replace the files of the same name in `node_modules/ink/build/`
(Ink 8.0.0). They keep what Ink computes from one frame to the next (the tokenised lines, the clipped slices, the
rows, the width of each text) so a frame that changed two rows costs about what two rows cost, instead of the whole
screen. The terminal output is byte-for-byte the same. Measurements and the reasoning:
[AUDIT-performance-2.md](../../AUDIT-performance-2.md), PERF2-01 and PERF2-07.

- `*.stock.js` — the unmodified Ink 8.0.0 files. `scripts/apply-ink-patch.mjs` only overwrites files that equal
  them (or an older version of our own patch), and `tests/unit/inkOutputPatch.test.ts` renders the same random frames
  through the stock and the patched `output.js` and compares the strings, and checks that the patched
  `render-node-to-output.js` differs from the stock one only in where `widestLine` comes from.
- `output.js` — the patched output stage. Every change is marked with `[1]` … `[4]` in its header comment.
- `render-node-to-output.js` — one changed import: `widestLine` comes from the cache of `output.js` ([4]).

## Who uses it

- **The repository**: `yarn install` runs `prepare`, which runs `scripts/apply-ink-patch.mjs`. Dev runs, the TUI
  harness and the tests then use the patched file.
- **Users**: `ink` is bundled into `dist` (`noExternal` in `tsup.config.ts`), from the patched file. The build
  stops if `node_modules/ink` is not the patched one.

## Upgrading Ink

1. Change the exact `ink` version in `package.json` (it is pinned on purpose: the patch only knows 8.0.0) and `yarn install`; `apply-ink-patch` now warns ("neither the stock files nor the patched ones") and `yarn build` refuses to run.
2. Copy the new `node_modules/ink/build/output.js` and `render-node-to-output.js` to `output.stock.js` and
   `render-node-to-output.stock.js` (without the trailing `//# sourceMappingURL` line), redo the changes on them into
   `output.js` and `render-node-to-output.js` (the diff between each stock file and its patched file shows them), run
   `yarn test tests/unit/inkOutputPatch.test.ts`, then `node scripts/apply-ink-patch.mjs`.
3. If the new Ink caches across frames itself, delete the patch (`patches/`, the script, `prepare`, `noExternal`).
