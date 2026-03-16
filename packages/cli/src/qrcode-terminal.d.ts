declare module "qrcode-terminal" {
  interface QRCodeTerminal {
    generate(text: string, opts: { small: boolean }, callback: (qr: string) => void): void;
    generate(text: string, callback: (qr: string) => void): void;
  }
  const qrcode: QRCodeTerminal;
  export default qrcode;
}
