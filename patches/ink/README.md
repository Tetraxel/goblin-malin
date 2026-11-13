# Patched Ink output stage

`output.js` replaces `node_modules/ink/build/output.js` (Ink 8.0.0). It keeps what Ink computes from one frame to
the next (the tokenised lines, the clipped slices, the rows) so a frame that changed two rows costs about what two
rows cost, instead of the whole screen. The terminal output is byte-for-byte the same. Measurements and the
reasoning: [AUDIT-performance-2.md](../../AUDIT-performance-2.md), PERF2-01.

- `output.stock.js` — the unmodified Ink 8.0.0 file. `scripts/apply-ink-patch.mjs` only overwrites a file that
  equals it, and `tests/unit/inkOutputPatch.test.ts` renders the same random frames through both files and compares
  the strings.
- `output.js` — the patched file. Every change is marked with `[1]`, `[2]`, `[3]` in its header comment.

## Who uses it

- **The repository**: `yarn install` runs `prepare`, which runs `scripts/apply-ink-patch.mjs`. Dev runs, the TUI
  harness and the tests then use the patched file.
- **Users**: `ink` is bundled into `dist` (`noExternal` in `tsup.config.ts`), from the patched file. The build
  stops if `node_modules/ink` is not the patched one.

## Upgrading Ink

1. `yarn upgrade ink`; `apply-ink-patch` now fails ("neither the stock file nor the patched one").
2. Copy the new `node_modules/ink/build/output.js` to `output.stock.js`, redo the three changes on it into
   `output.js` (the diff between the old `output.stock.js` and `output.js` shows them), run
   `yarn test tests/unit/inkOutputPatch.test.ts`, then `node scripts/apply-ink-patch.mjs`.
3. If the new Ink caches across frames itself, delete the patch (`patches/`, the script, `prepare`, `noExternal`).
