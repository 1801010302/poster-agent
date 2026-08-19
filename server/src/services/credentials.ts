import { and, eq } from "drizzle-orm";
import { db, secret } from "edgespark";
import { providerCredentials } from "@defs";
import { AppError } from "./access";
import { decryptCredential, encryptCredential } from "./crypto";

export type ProviderName = "deepseek" | "image2";

export async function getUserProviderKey(userId: string, provider: ProviderName): Promise<string> {
  const masterKey = secret.get("USER_CREDENTIAL_MASTER_KEY");
  if (!masterKey) throw new AppError("VAULT_NOT_CONFIGURED", "密钥保险箱尚未配置", 503);
  const [credential] = await db.select().from(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, provider)))
    .limit(1);
  if (!credential || credential.status !== "connected") {
    throw new AppError("PROVIDER_NOT_CONNECTED", provider === "deepseek" ? "请先配置 DeepSeek API Key" : "请先配置 Image2 API Key", 400);
  }
  return decryptCredential(
    credential.ciphertext,
    credential.iv,
    masterKey,
    `${userId}:${provider}:${credential.keyVersion}`,
  );
}

export async function saveUserProviderKey(userId: string, provider: ProviderName, apiKey: string) {
  const masterKey = secret.get("USER_CREDENTIAL_MASTER_KEY");
  if (!masterKey) throw new AppError("VAULT_NOT_CONFIGURED", "密钥保险箱尚未配置", 503);
  const normalized = apiKey.trim();
  if (normalized.length < 12 || normalized.length > 512) {
    throw new AppError("INVALID_API_KEY", "请输入完整的 API Key", 400);
  }
  const now = Date.now();
  const keyVersion = 1;
  const encrypted = await encryptCredential(normalized, masterKey, `${userId}:${provider}:${keyVersion}`);
  const keyPrefix = normalized.slice(0, Math.min(7, Math.max(3, normalized.length - 4)));
  const keyLast4 = normalized.slice(-4);
  await db.insert(providerCredentials).values({
    id: crypto.randomUUID(),
    userId,
    provider,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    keyVersion,
    keyPrefix,
    keyLast4,
    status: "connected",
    verifiedAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [providerCredentials.userId, providerCredentials.provider],
    set: {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      keyVersion,
      keyPrefix,
      keyLast4,
      status: "connected",
      verifiedAt: now,
      updatedAt: now,
    },
  });
  return { connected: true, status: "connected", maskedKey: `${keyPrefix}••••••${keyLast4}`, verifiedAt: now };
}

export function credentialView(row: { keyPrefix: string; keyLast4: string; status: string; verifiedAt: number } | undefined) {
  if (!row) return { connected: false, status: "not_connected", maskedKey: null, verifiedAt: null };
  return {
    connected: row.status === "connected",
    status: row.status,
    maskedKey: `${row.keyPrefix}••••••${row.keyLast4}`,
    verifiedAt: row.verifiedAt,
  };
}
