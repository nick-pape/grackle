# Web Components Package Rules

- **Any list that can grow beyond ~100 items must be virtualized from the start.** Don't add virtualization later — it's a different component architecture.
- **Consider `React.memo()` for components rendered in large lists with stable props.** Don't cargo-cult it on every loop — only where re-renders are measurably costly.
