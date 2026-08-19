import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db, secret } from "edgespark";
import { auth } from "edgespark/http";
import {
  accessGrants,
  auditLogs,
  inviteCodes,
  inviteRedemptions,
  providerCredentials,
} from "@defs";
import { ensureProfile, getAccessState } from "../services/access";
import { digestInviteCode } from "../services/crypto";

function availableInvite(digest: string, now: number) {
  return and(
    eq(inviteCodes.codeDigest, digest),
    eq(inviteCodes.status, "active"),
    or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, now)),
  );
}

export const accessRoutes = new Hono()
  .get("/api/public/health", (c) => c.json({ ok: true, service: "wechat-poster-agent", time: new Date().toISOString() }))
  .get("/api/access/status", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    await ensureProfile(auth.user);
    const state = await getAccessState(auth.user.id);
    const rows = await db.select({
      provider: providerCredentials.provider,
      status: providerCredentials.status,
      keyPrefix: providerCredentials.keyPrefix,
      keyLast4: providerCredentials.keyLast4,
    }).from(providerCredentials).where(eq(providerCredentials.userId, auth.user.id));
    const provider = (name: string) => {
      const row = rows.find((item) => item.provider === name);
      return row ? { connected: row.status === "connected", status: row.status, maskedKey: `${row.keyPrefix}••••••${row.keyLast4}` } : { connected: false, status: "not_connected", maskedKey: null };
    };
    return c.json({ ok: true, data: { ...state, email: auth.user.email, name: auth.user.name, providers: { deepseek: provider("deepseek"), image2: provider("image2") } } });
  })
  .post("/api/access/redeem", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    await ensureProfile(auth.user);
    const hmacKey = secret.get("INVITE_CODE_HMAC_KEY");
    if (!hmacKey) return c.json({ ok: false, error: { code: "NOT_CONFIGURED", message: "暗号服务尚未配置" } }, 503);
    const body = await c.req.json<{ code?: string }>().catch(() => ({} as { code?: string }));
    const code = (body.code || "").trim();
    if (code.length < 8 || code.length > 80) {
      return c.json({ ok: false, error: { code: "INVALID_CODE", message: "请输入完整暗号" } }, 400);
    }
    const existingState = await getAccessState(auth.user.id);
    if (existingState.activated) return c.json({ ok: true, data: { ...existingState, alreadyActivated: true } });

    const now = Date.now();
    const digest = await digestInviteCode(code, hmacKey);
    const [invite] = await db.select().from(inviteCodes).where(availableInvite(digest, now)).limit(1);
    if (!invite || invite.usedCount >= invite.maxUses) {
      return c.json({ ok: false, error: { code: "INVITE_UNAVAILABLE", message: "这个暗号无效、已过期或名额已用完" } }, 400);
    }
    const [existingRedemption] = await db.select().from(inviteRedemptions)
      .where(eq(inviteRedemptions.userId, auth.user.id)).limit(1);
    if (existingRedemption) {
      return c.json({ ok: false, error: { code: "ALREADY_REDEEMED", message: "这个账号已经使用过暗号" } }, 409);
    }
    // Claim one use atomically before granting access. The conditional update is
    // the capacity guard when multiple users redeem the final slot together.
    const [claimed] = await db.update(inviteCodes).set({
      usedCount: sql`${inviteCodes.usedCount} + 1`,
      updatedAt: now,
    }).where(and(
      availableInvite(digest, now),
      lt(inviteCodes.usedCount, inviteCodes.maxUses),
    )).returning({ id: inviteCodes.id });
    if (!claimed) {
      return c.json({ ok: false, error: { code: "INVITE_UNAVAILABLE", message: "这个暗号无效、已过期或名额已用完" } }, 400);
    }

    try {
      await db.batch([
        db.insert(inviteRedemptions).values({
          id: crypto.randomUUID(), inviteCodeId: invite.id, userId: auth.user.id, redeemedAt: now,
        }),
        db.insert(accessGrants).values({
          userId: auth.user.id, status: "active", source: "invite_code", grantedAt: now,
          expiresAt: null, revokedAt: null, updatedAt: now,
        }).onConflictDoUpdate({
          target: accessGrants.userId,
          set: { status: "active", source: "invite_code", grantedAt: now, expiresAt: null, revokedAt: null, updatedAt: now },
        }),
        db.insert(auditLogs).values({
          id: crypto.randomUUID(), actorUserId: auth.user.id, action: "access.invite_redeemed",
          targetType: "invite_code", targetId: invite.id, safeMetadataJson: "{}", createdAt: now,
        }),
      ]);
    } catch (error) {
      // A concurrent request from the same account may already have completed.
      // If not, release the claimed capacity before surfacing the failure.
      const [redemption] = await db.select({ id: inviteRedemptions.id }).from(inviteRedemptions)
        .where(eq(inviteRedemptions.userId, auth.user.id)).limit(1);
      if (redemption) {
        const state = await getAccessState(auth.user.id);
        if (state.activated) return c.json({ ok: true, data: { ...state, alreadyActivated: true } });
      }
      await db.update(inviteCodes).set({
        usedCount: sql`max(${inviteCodes.usedCount} - 1, 0)`,
        updatedAt: Date.now(),
      }).where(eq(inviteCodes.id, invite.id));
      throw error;
    }
    return c.json({ ok: true, data: { activated: true, accessStatus: "active", accessSource: "invite_code", accessExpiresAt: null, role: "user", alreadyActivated: false } });
  });
