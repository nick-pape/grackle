import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { hostname, userInfo } from "node:os";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100_000;

function deriveKey(salt: Buffer): Buffer {
  const masterKey = process.env.GRACKLE_MASTER_KEY || `${hostname()}:${userInfo().username}:grackle`;
  return pbkdf2Sync(masterKey, salt, ITERATIONS, KEY_LENGTH, "sha256");
}

export function encrypt(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: salt:iv:tag:ciphertext (all base64)
  return [salt, iv, tag, encrypted].map((b) => b.toString("base64")).join(":");
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4) throw new Error("Invalid encrypted format");

  const [salt, iv, tag, encrypted] = parts.map((p) => Buffer.from(p, "base64"));

  const key = deriveKey(salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
