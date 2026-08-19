import { and, desc, eq, gt, ne } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { db, secret, vars } from "edgespark";
import { auth } from "edgespark/http";
import { accessGrants, auditLogs, paymentOrders, paymentTransactions } from "@defs";
import { AppError, ensureProfile, getAccessState } from "../services/access";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const annualPlan = {
  code: "annual_800",
  name: "朋友圈海报智能体年费会员",
  amountFen: 80000,
  currency: "CNY",
  billingCycle: "year",
  inviteAccessFree: true,
};

type PaymentSecretKey =
  | "WECHAT_PAY_MCH_ID"
  | "WECHAT_PAY_APP_ID"
  | "WECHAT_PAY_MERCHANT_SERIAL_NO"
  | "WECHAT_PAY_API_V3_KEY"
  | "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM"
  | "WECHAT_PAY_PUBLIC_KEY_ID"
  | "WECHAT_PAY_PUBLIC_KEY_PEM";

// Payment is intentionally optional for the first release. These keys are not
// part of the required EdgeSpark SecretKey union until the operator decides to
// enable WeChat Pay, so their absence never blocks an otherwise valid deploy.
function paymentSecret(name: PaymentSecretKey): string | null {
  return (secret as unknown as { get(key: string): string | null }).get(name);
}

function fail(c: Context, error: unknown) {
  if (error instanceof AppError) return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
  console.error("Billing error", error instanceof Error ? error.message : "unknown");
  return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "支付服务暂时不可用" } }, 500);
}

function paymentConfigured() {
  const secretKeys = [
    "WECHAT_PAY_MCH_ID", "WECHAT_PAY_APP_ID", "WECHAT_PAY_MERCHANT_SERIAL_NO",
    "WECHAT_PAY_API_V3_KEY", "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM",
    "WECHAT_PAY_PUBLIC_KEY_ID", "WECHAT_PAY_PUBLIC_KEY_PEM",
  ] as const;
  return vars.get("WECHAT_PAY_ENABLED") === "true"
    && Boolean(vars.get("WECHAT_PAY_NOTIFY_URL"))
    && secretKeys.every((key) => Boolean(paymentSecret(key)));
}

function randomHex(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(input: string) {
  const binary = atob(input);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importPublicKey(pem: string) {
  const normalized = pem
    .replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "")
    .replace("-----BEGIN CERTIFICATE-----", "").replace("-----END CERTIFICATE-----", "")
    .replace(/\s/gu, "");
  return crypto.subtle.importKey("spki", base64ToBytes(normalized), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

async function importPrivateKey(pem: string) {
  const normalized = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/gu, "");
  return crypto.subtle.importKey("pkcs8", base64ToBytes(normalized), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function signWechatRequest(method: string, path: string, body: string) {
  const mchid = paymentSecret("WECHAT_PAY_MCH_ID") || "";
  const serialNo = paymentSecret("WECHAT_PAY_MERCHANT_SERIAL_NO") || "";
  const privateKeyPem = paymentSecret("WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM") || "";
  if (!mchid || !serialNo || !privateKeyPem) throw new AppError("PAYMENT_NOT_CONFIGURED", "微信支付商户签名尚未配置", 503);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomHex(16);
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(message));
  return [
    `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}"`,
    `nonce_str="${nonce}"`,
    `signature="${bytesToBase64(new Uint8Array(signature))}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${serialNo}"`,
  ].join(",");
}

async function requestWechat<T>(path: string, method: "GET" | "POST", body = "") {
  const baseUrl = (vars.get("WECHAT_PAY_API_BASE") || "https://api.mch.weixin.qq.com").replace(/\/+$/u, "");
  const authorization = await signWechatRequest(method, path, body);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      "User-Agent": "WechatPosterAgent/1.0",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response) return { ok: false as const, error: "微信支付暂时无法连接" };
  const data = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) return { ok: false as const, error: data.message || `微信支付请求失败（${response.status}）` };
  return { ok: true as const, data };
}

async function createWechatNativeOrder(order: typeof paymentOrders.$inferSelect) {
  const mchid = paymentSecret("WECHAT_PAY_MCH_ID") || "";
  const appid = paymentSecret("WECHAT_PAY_APP_ID") || "";
  const notifyUrl = vars.get("WECHAT_PAY_NOTIFY_URL") || "";
  const currency = vars.get("WECHAT_PAY_CURRENCY") || "CNY";
  if (!mchid || !appid || !notifyUrl) return { ok: false as const, error: "微信支付配置不完整" };
  const body = JSON.stringify({
    appid,
    mchid,
    description: "朋友圈海报智能体年费会员",
    out_trade_no: order.merchantOrderNo,
    time_expire: order.expiresAt ? new Date(order.expiresAt).toISOString().replace(/\.\d{3}Z$/u, "+00:00") : undefined,
    notify_url: notifyUrl,
    amount: { total: order.amountFen, currency },
    attach: JSON.stringify({ userId: order.userId, plan: annualPlan.code }),
  });
  const result = await requestWechat<{ code_url?: string }>("/v3/pay/transactions/native", "POST", body);
  if (!result.ok) return result;
  if (!result.data.code_url) return { ok: false as const, error: "微信支付未返回二维码链接" };
  return { ok: true as const, codeUrl: result.data.code_url };
}

async function recordTransaction(order: typeof paymentOrders.$inferSelect | null, input: {
  transactionId?: string | null; eventType: string; status: string; amountFen: number; verified: boolean; raw?: string;
}) {
  await db.insert(paymentTransactions).values({
    id: crypto.randomUUID(),
    orderId: order?.id || null,
    userId: order?.userId || null,
    providerTransactionId: input.transactionId || null,
    eventType: input.eventType,
    status: input.status,
    amountFen: input.amountFen,
    verified: input.verified,
    rawEventJson: input.raw ? input.raw.slice(0, 20000) : null,
    createdAt: Date.now(),
  });
}

async function markPaid(orderId: string, transactionId: string, raw: string) {
  const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, orderId)).limit(1);
  if (!order || order.status === "paid") return;
  const [grant] = await db.select().from(accessGrants).where(eq(accessGrants.userId, order.userId)).limit(1);
  const now = Date.now();
  const base = grant?.expiresAt && grant.expiresAt > now ? grant.expiresAt : now;
  const expiresAt = base + YEAR_MS;
  try {
    await db.batch([
      db.update(paymentOrders).set({
        status: "paid", providerTransactionId: transactionId, paidAt: now, failureReason: null, updatedAt: now,
      }).where(and(eq(paymentOrders.id, order.id), ne(paymentOrders.status, "paid"))),
      db.insert(accessGrants).values({
        userId: order.userId, status: "active", source: "wechat_pay", grantedAt: now,
        expiresAt, revokedAt: null, updatedAt: now,
      }).onConflictDoUpdate({
        target: accessGrants.userId,
        set: { status: "active", source: "wechat_pay", grantedAt: now, expiresAt, revokedAt: null, updatedAt: now },
      }),
      db.insert(paymentTransactions).values({
        id: crypto.randomUUID(), orderId: order.id, userId: order.userId,
        providerTransactionId: transactionId, eventType: "payment_success", status: "success",
        amountFen: order.amountFen, verified: true, rawEventJson: raw.slice(0, 20000), createdAt: now,
      }),
      db.insert(auditLogs).values({
        id: crypto.randomUUID(), actorUserId: order.userId, action: "billing.annual_paid",
        targetType: "payment_order", targetId: order.id,
        safeMetadataJson: JSON.stringify({ amountFen: order.amountFen, expiresAt }), createdAt: now,
      }),
    ]);
  } catch (error) {
    const [current] = await db.select({ status: paymentOrders.status }).from(paymentOrders).where(eq(paymentOrders.id, order.id)).limit(1);
    if (current?.status === "paid") return;
    throw error;
  }
}

async function queryOrder(order: typeof paymentOrders.$inferSelect) {
  if (order.status !== "pending" || !paymentConfigured()) return order;
  const mchid = paymentSecret("WECHAT_PAY_MCH_ID") || "";
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.merchantOrderNo)}?mchid=${encodeURIComponent(mchid)}`;
  const result = await requestWechat<Record<string, unknown>>(path, "GET");
  if (!result.ok) return order;
  const tradeState = String(result.data.trade_state || "");
  const transactionId = String(result.data.transaction_id || "");
  const amount = result.data.amount && typeof result.data.amount === "object" ? result.data.amount as Record<string, unknown> : {};
  const amountFen = Number(amount.payer_total || amount.total || 0);
  const merchantMatches = String(result.data.mchid || "") === (paymentSecret("WECHAT_PAY_MCH_ID") || "")
    && String(result.data.appid || "") === (paymentSecret("WECHAT_PAY_APP_ID") || "")
    && String(amount.currency || "") === order.currency;
  if (tradeState === "SUCCESS" && transactionId && amountFen === order.amountFen && merchantMatches) {
    await markPaid(order.id, transactionId, JSON.stringify({ source: "wechat_query", tradeState }));
    const [updated] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, order.id)).limit(1);
    return updated || order;
  }
  if (order.expiresAt && order.expiresAt <= Date.now()) {
    const [updated] = await db.update(paymentOrders).set({ status: "expired", updatedAt: Date.now() }).where(eq(paymentOrders.id, order.id)).returning();
    return updated || order;
  }
  return order;
}

async function decryptWechatResource(resource: { ciphertext?: string; nonce?: string; associated_data?: string }) {
  const apiV3Key = paymentSecret("WECHAT_PAY_API_V3_KEY") || "";
  if (!apiV3Key || !resource.ciphertext || !resource.nonce) throw new Error("缺少微信支付加密资源字段");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(apiV3Key), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: new TextEncoder().encode(resource.nonce),
    additionalData: resource.associated_data ? new TextEncoder().encode(resource.associated_data) : undefined,
  }, key, base64ToBytes(resource.ciphertext));
  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;
}

async function verifyWechatCallback(rawBody: string, signature: string, timestamp: string, nonce: string, serial: string) {
  if (!signature || !timestamp || !nonce || !serial) return { ok: false as const };
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > 300) return { ok: false as const };
  const publicKeyPem = paymentSecret("WECHAT_PAY_PUBLIC_KEY_PEM");
  const expectedSerial = paymentSecret("WECHAT_PAY_PUBLIC_KEY_ID");
  if (!publicKeyPem || !expectedSerial || serial !== expectedSerial) return { ok: false as const };
  const key = await importPublicKey(publicKeyPem).catch(() => null);
  if (!key) return { ok: false as const };
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, base64ToBytes(signature), new TextEncoder().encode(`${timestamp}\n${nonce}\n${rawBody}\n`),
  ).catch(() => false);
  if (!valid) return { ok: false as const };
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown> & { resource?: { ciphertext?: string; nonce?: string; associated_data?: string } };
    const event = parsed.resource?.ciphertext ? await decryptWechatResource(parsed.resource) : parsed;
    return { ok: true as const, event };
  } catch { return { ok: false as const }; }
}

export const billingRoutes = new Hono()
  .get("/api/public/billing/plan", (c) => c.json({ ok: true, data: { ...annualPlan, paymentConfigured: paymentConfigured() } }))
  .get("/api/billing/orders", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    const rows = await db.select().from(paymentOrders).where(eq(paymentOrders.userId, auth.user.id)).orderBy(desc(paymentOrders.createdAt)).limit(50);
    return c.json({ ok: true, data: rows });
  })
  .post("/api/billing/checkout", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await ensureProfile(auth.user);
      const access = await getAccessState(auth.user.id);
      if (access.activated && access.accessExpiresAt === null) throw new AppError("ALREADY_EXEMPT", "这个账号已经免年费，无需购买", 409);
      if (!paymentConfigured()) throw new AppError("PAYMENT_NOT_CONFIGURED", "微信支付尚未完成商户配置，请联系管理员", 503);
      const now = Date.now();
      const [existing] = await db.select().from(paymentOrders).where(and(
        eq(paymentOrders.userId, auth.user.id),
        eq(paymentOrders.status, "pending"),
        gt(paymentOrders.expiresAt, now + 60_000),
      )).orderBy(desc(paymentOrders.createdAt)).limit(1);
      if (existing?.codeUrl) {
        return c.json({
          ok: true,
          data: { order: existing, payment: { provider: "wechat_pay", mode: "wechat_native", codeUrl: existing.codeUrl, configured: true, reused: true } },
        });
      }
      const expireMinutes = Math.max(5, Math.min(120, Number(vars.get("WECHAT_PAY_ORDER_EXPIRE_MINUTES") || "30")));
      const merchantOrderNo = `HB${Date.now()}${randomHex(3).toUpperCase()}`;
      let [order] = await db.insert(paymentOrders).values({
        id: crypto.randomUUID(), userId: auth.user.id, merchantOrderNo,
        amountFen: annualPlan.amountFen, currency: annualPlan.currency, status: "pending",
        expiresAt: now + expireMinutes * 60_000, createdAt: now, updatedAt: now,
      }).returning();
      const native = await createWechatNativeOrder(order);
      if (!native.ok) {
        await db.update(paymentOrders).set({ status: "failed", failureReason: native.error, updatedAt: Date.now() }).where(eq(paymentOrders.id, order.id));
        throw new AppError("WECHAT_ORDER_FAILED", native.error, 502);
      }
      const [updated] = await db.update(paymentOrders).set({ codeUrl: native.codeUrl, updatedAt: Date.now() }).where(eq(paymentOrders.id, order.id)).returning();
      order = updated || order;
      return c.json({ ok: true, data: { order, payment: { provider: "wechat_pay", mode: "wechat_native", codeUrl: native.codeUrl, configured: true } } }, 201);
    } catch (error) { return fail(c, error); }
  })
  .get("/api/billing/orders/:id", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      const [order] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.id, c.req.param("id")), eq(paymentOrders.userId, auth.user.id))).limit(1);
      if (!order) throw new AppError("ORDER_NOT_FOUND", "支付订单不存在", 404);
      const current = await queryOrder(order);
      return c.json({ ok: true, data: { order: current, access: await getAccessState(auth.user.id) } });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/webhooks/wechat-pay", async (c) => {
    const rawBody = await c.req.text();
    const verified = await verifyWechatCallback(
      rawBody,
      c.req.header("wechatpay-signature") || "",
      c.req.header("wechatpay-timestamp") || "",
      c.req.header("wechatpay-nonce") || "",
      c.req.header("wechatpay-serial") || "",
    );
    if (!verified.ok) {
      return c.json({ code: "FAIL", message: "签名校验失败" }, 401);
    }
    const event = verified.event;
    const merchantOrderNo = String(event.out_trade_no || "");
    const transactionId = String(event.transaction_id || "");
    const amount = event.amount && typeof event.amount === "object" ? event.amount as Record<string, unknown> : {};
    const amountFen = Number(amount.payer_total || amount.total || 0);
    const currency = String(amount.currency || "");
    const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.merchantOrderNo, merchantOrderNo)).limit(1);
    if (!order) return c.json({ code: "FAIL", message: "订单不存在" }, 404);
    const merchantMatches = String(event.mchid || "") === (paymentSecret("WECHAT_PAY_MCH_ID") || "")
      && String(event.appid || "") === (paymentSecret("WECHAT_PAY_APP_ID") || "")
      && currency === (vars.get("WECHAT_PAY_CURRENCY") || "CNY");
    if (!merchantMatches || String(event.trade_state || "") !== "SUCCESS" || amountFen !== order.amountFen || !transactionId) {
      await recordTransaction(order, { transactionId: transactionId || null, eventType: "callback_rejected", status: "rejected", amountFen, verified: true, raw: rawBody });
      return c.json({ code: "FAIL", message: "支付商户、金额或状态不匹配" }, 400);
    }
    await markPaid(order.id, transactionId, rawBody);
    return c.json({ code: "SUCCESS", message: "成功" });
  });
