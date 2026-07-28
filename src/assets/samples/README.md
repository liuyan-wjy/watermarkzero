# Sample Asset Notes

- This directory stores primary regression sample inputs used by local benchmarks and removal tests.
- Files here should be source-like fixtures, not derived output snapshots.
- Do not commit `*-after.*` files here. Derived outputs should live in a separate archive location or under non-tracked local output directories.
- Local processed snapshots under `fix/` are optional manual regression artifacts and are intentionally not tracked by git.
- Extreme aspect-ratio samples are kept on purpose because the selector and preview-anchor logic must handle them, not just common photo sizes.
