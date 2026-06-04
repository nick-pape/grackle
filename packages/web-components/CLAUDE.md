# Web Components Package Rules

- **Any list that can grow beyond ~100 items must be virtualized from the start.** Don't add virtualization later — it's a different component architecture.
- **Components rendered in loops must use `React.memo()`.**
