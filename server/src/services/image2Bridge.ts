import { AppError } from "./access";

const encoder = new TextEncoder();

const IMAGE2_BRIDGE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAm730m4XhWCpI+DGa6LOE
jWIDXEa5bjLCTXRH6pCJlAJ5wc6mQ3bH+hlpargJIo6ki4Qzyp80ygwFMO5Y+ghi
AQMfALQktaYKjq5SiKwOyDG9p+ZgxK3PIZjZoci3dKK6VeqHhRxpvp8Q2EXrdY+Z
ErQdnxPlX3u2SKQm+ElDAfai6rzalm0ZF8EsYWKPLDGeCT2V9VBMoDvQFo30IL5V
xCR0+2DKW2+3AGb87ZePy2pRAPMV+c2KH4m+Xz4FneAG7lDIyGmY1CDsAQcJNuw7
qAupQ/9oT2xJGbsgCsfkFBIGJjWniJz+W0NSCzxJvvm7vU7zgKMiMBsbDYf9iWHn
mwIDAQAB
-----END PUBLIC KEY-----`;

function pemToBytes(pem: string): Uint8Array {
  const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/gu, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function createImage2BridgeEnvelope(apiKey: string): Promise<{ envelope: string; expiresAt: number }> {
  const expiresAt = Date.now() + 15 * 60 * 1000;
  try {
    const publicKey = await crypto.subtle.importKey(
      "spki",
      pemToBytes(IMAGE2_BRIDGE_PUBLIC_KEY_PEM),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
    const plaintext = encoder.encode(JSON.stringify({
      v: 1,
      aud: "wechat-poster-image2",
      apiKey,
      exp: expiresAt,
    }));
    const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, plaintext);
    return { envelope: bytesToBase64Url(new Uint8Array(encrypted)), expiresAt };
  } catch {
    throw new AppError("IMAGE2_BRIDGE_UNAVAILABLE", "Image2 安全连接暂时不可用", 503);
  }
}
