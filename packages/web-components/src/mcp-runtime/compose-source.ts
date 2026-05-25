/**
 * Source composition for GenUX cross-component rendering (#1270).
 *
 * Pure string builder (no React/side-effects) so it's unit-testable in isolation
 * from the runtime entry (`index.tsx`, which mounts on import).
 */

/** A resolved registry dependency: another component this render composes from. */
export interface RenderDependency {
  /** Name referenced as a JSX tag in the body (a valid identifier). */
  name: string;
  /** The dependency's stored body (calls `render(<… props …>)`, like any component). */
  body: string;
}

/**
 * Compose the source react-live evaluates: prepend each resolved dependency as a
 * local component definition, then the root body. Each dependency is the Phase-1
 * `render(<…props…>)` form, so it's wrapped in a `(props) => element` function with
 * a *local* `render` capture (mirroring react-live `noInline`); the outer `render`
 * the root calls stays react-live's. Dependencies are emitted deepest-first so a
 * dependency can reference earlier ones; built-ins remain in the outer scope.
 */
export function composeSource(source: string, components: readonly RenderDependency[]): string {
  const defs = components
    .map((d) => `const ${d.name} = (props) => { let __el; const render = (el) => { __el = el; };\n${d.body}\n; return __el; };`)
    .join("\n");
  return defs ? `${defs}\n${source}` : source;
}
