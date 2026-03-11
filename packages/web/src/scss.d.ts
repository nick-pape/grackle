/** Type declarations for SCSS module imports. */
declare module "*.module.scss" {
  /** Map of local class names to their CSS module-scoped equivalents. */
  const classes: { readonly [key: string]: string };
  export default classes;
}

/** Type declarations for plain SCSS imports (side-effect only). */
declare module "*.scss" {
  const content: string;
  export default content;
}
