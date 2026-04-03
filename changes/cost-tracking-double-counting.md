### Fix cost tracking double-counting

Fixes issue where Grackle was double-counting session costs by summing all usage events. Usage events contain cumulative values, so the correct approach is to use the last reported value. Also fixes the same issue for token counts (input/output tokens).

#### Affected files
- `packages/web/src/hooks/useSessions.ts`: Changed from summing usage event values to using the last reported values for costMillicents, inputTokens, and outputTokens