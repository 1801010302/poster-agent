import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, vars } from "edgespark";
import { auth } from "edgespark/http";
import { auditLogs, providerCredentials } from "@defs";
import { AppError, requireActiveAccess } from "../services/access";
import { credentialView, saveUserProviderKey, type ProviderName } from "../services/credentials";

function fail(c: Parameters<Parameters<Hono["onError"]>[0]>[1], error: unknown) {
  if (error instanceof AppError) return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
  console.error("Settings error", error instanceof Error ? error.message : "unknown");
  return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "服务设置暂时不可用" } }, 500);
}

function providerBase(provider: ProviderName) {
  return provider === "deepseek"
    ? (vars.get("DEEPSEEK_API_BASE") || "https://api.deepseek.com").replace(/\/+$/u, "")
    : (vars.get("IMAGE2_API_BASE") || "https://openapi.yiminju.xyz/api/public/v1").replace(/\/+$/u, "");
}

async function testProvider(provider: ProviderName, apiKey: string) {
  // Image2 /models is public and cannot prove that a key is valid. /balance is
  // authenticated and read-only, so it validates the key without creating a
  // task or charging the account.
  const pathname = provider === "image2" ? "/balance" : "/models";
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${providerBase(provider)}${pathname}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!response) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        continue;
      }
      throw new AppError("PROVIDER_UNAVAILABLE", "暂时无法连接服务，请稍后重试", 503);
    }
    lastStatus = response.status;
    if (response.status === 401 || response.status === 403) {
      throw new AppError("INVALID_API_KEY", "这个 API Key 无效，请检查后重试", 400);
    }
    if (response.ok) return;
    if (response.status >= 500 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      continue;
    }
    break;
  }
  throw new AppError("PROVIDER_UNAVAILABLE", `服务连接失败（${lastStatus || "网络异常"}）`, 502);
}

export const settingsRoutes = new Hono()
  .get("/api/settings", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const rows = await db.select({
        provider: providerCredentials.provider,
        keyPrefix: providerCredentials.keyPrefix,
        keyLast4: providerCredentials.keyLast4,
        status: providerCredentials.status,
        verifiedAt: providerCredentials.verifiedAt,
      }).from(providerCredentials).where(eq(providerCredentials.userId, auth.user.id));
      const get = (provider: ProviderName) => credentialView(rows.find((row) => row.provider === provider));
      const deepseek = get("deepseek");
      const image2 = get("image2");
      return c.json({ ok: true, data: { deepseek, image2, deepseekConfigured: deepseek.connected, image2Configured: image2.connected, allConfigured: deepseek.connected && image2.connected } });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/settings/:provider", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const provider = c.req.param("provider") as ProviderName;
      if (provider !== "deepseek" && provider !== "image2") throw new AppError("INVALID_PROVIDER", "不支持这个服务", 400);
      const body = await c.req.json<{ apiKey?: string }>().catch(() => ({} as { apiKey?: string }));
      const apiKey = (body.apiKey || "").trim();
      if (apiKey.length < 12) throw new AppError("INVALID_API_KEY", "请输入完整的 API Key", 400);
      // Image2 is saved without a preflight request. Its gateway has shown
      // intermittent 522s even when the same key generates successfully in
      // other clients, so connectivity must not prevent encrypted storage.
      // The real generation call remains the authoritative runtime check.
      if (provider === "deepseek") await testProvider(provider, apiKey);
      const result = await saveUserProviderKey(auth.user.id, provider, apiKey);
      await db.insert(auditLogs).values({
        id: crypto.randomUUID(), actorUserId: auth.user.id, action: "provider.connected",
        targetType: "provider", targetId: provider,
        safeMetadataJson: JSON.stringify({ keyLast4: apiKey.slice(-4), validation: provider === "image2" ? "deferred_to_generation" : "preflight_passed" }),
        createdAt: Date.now(),
      });
      return c.json({ ok: true, data: { ...result, validation: provider === "image2" ? "deferred_to_generation" : "preflight_passed" } });
    } catch (error) { return fail(c, error); }
  })
  .delete("/api/settings/:provider", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const provider = c.req.param("provider");
      if (provider !== "deepseek" && provider !== "image2") throw new AppError("INVALID_PROVIDER", "不支持这个服务", 400);
      await db.delete(providerCredentials).where(and(eq(providerCredentials.userId, auth.user.id), eq(providerCredentials.provider, provider)));
      return c.json({ ok: true, data: { connected: false, status: "not_connected" } });
    } catch (error) { return fail(c, error); }
  });
