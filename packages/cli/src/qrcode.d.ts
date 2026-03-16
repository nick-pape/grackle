declare module "qrcode" {
  export function toString(text: string, opts?: { type?: string; small?: boolean }): Promise<string>;
  export function toDataURL(text: string, opts?: Record<string, unknown>): Promise<string>;
}
