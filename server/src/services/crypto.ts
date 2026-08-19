const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importHmacKey(secretValue: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secretValue),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export function normalizeInviteCode(value: string): string {
  return value.trim().toUpperCase().replaceAll(/\s+/gu, "");
}

export async function digestInviteCode(value: string, secretValue: string): Promise<string> {
  const key = await importHmacKey(secretValue);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`invite-code:${normalizeInviteCode(value)}`),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function importEncryptionKey(masterSecret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(masterSecret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptCredential(
  plaintext: string,
  masterSecret: string,
  additionalData: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importEncryptionKey(masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(additionalData) },
    key,
    encoder.encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
    iv: bytesToBase64Url(iv),
  };
}

export async function decryptCredential(
  ciphertext: string,
  iv: string,
  masterSecret: string,
  additionalData: string,
): Promise<string> {
  const key = await importEncryptionKey(masterSecret);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(iv),
      additionalData: encoder.encode(additionalData),
    },
    key,
    base64UrlToBytes(ciphertext),
  );
  return decoder.decode(decrypted);
}

export function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const value = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `HAIBAO-${value.slice(0, 4)}-${value.slice(4)}`;
}
