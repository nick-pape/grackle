# Core Package Rules

- **New `process.env` reads must go through the centralized config provider, not inline.**
- **Before adding a new utility (retry, timestamp, etc.), check if one already exists in common.** Don't re-implement.
- **If a file exceeds ~400 lines, split before adding to it.**
