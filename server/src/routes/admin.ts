import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  max,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Hono, type Context } from "hono";
import { db, secret, storage } from "edgespark";
import { auth } from "edgespark/http";
import {
  accessGrants,
  appProfiles,
  auditLogs,
  esSystemAuthUser,
  inviteCodes,
  paymentOrders,
  posterJobs,
  providerCredentials,
  userDailyActivity,
} from "@defs";
import { AppError, requireAdmin } from "../services/access";
import { digestInviteCode, randomCode } from "../services/crypto";
import { beijingDayKey, beijingDayStart, recentBeijingDayKeys } from "../services/time";

const DAY_MS = 24 * 60 * 60 * 1000;

function fail(c: Context, error: unknown) {
  if (error instanceof AppError) return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
  console.error("Admin route error", error instanceof Error ? error.message : "unknown");
  return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "管理后台暂时不可用" } }, 500);
}

function safeInvite(invite: typeof inviteCodes.$inferSelect) {
  return {
    id: invite.id,
    label: invite.label,
    status: invite.status,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  };
}

function numberParam(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function pageParams(c: Context) {
  return {
    page: numberParam(c.req.query("page"), 1, 1, 100000),
    pageSize: numberParam(c.req.query("pageSize"), 20, 10, 50),
  };
}

function nonAdminCondition() {
  return or(isNull(appProfiles.role), ne(appProfiles.role, "admin"));
}

function activeAccessCondition(now: number) {
  return and(
    eq(accessGrants.status, "active"),
    or(isNull(accessGrants.expiresAt), gte(accessGrants.expiresAt, now)),
  );
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function rate(completed: number, failed: number) {
  const settled = completed + failed;
  return settled ? Math.round((completed / settled) * 1000) / 10 : 0;
}

function failureCategory(message: string | null) {
  const value = (message || "").toLowerCase();
  if (value.includes("余额") || value.includes("402") || value.includes("insufficient")) return { key: "balance", label: "余额不足" };
  if (value.includes("key") || value.includes("密钥") || value.includes("401") || value.includes("鉴权")) return { key: "auth", label: "密钥或鉴权" };
  if (value.includes("安全") || value.includes("审核") || value.includes("moderation") || value.includes("policy")) return { key: "moderation", label: "内容安全" };
  if (value.includes("超时") || value.includes("连接") || value.includes("timeout") || value.includes("network") || value.includes("fetch")) return { key: "network", label: "网络或超时" };
  if (value.includes("参数") || value.includes("格式") || value.includes("invalid") || value.includes("400")) return { key: "request", label: "请求参数" };
  if (value.includes("限额") || value.includes("429") || value.includes("rate")) return { key: "limit", label: "频率或限额" };
  return { key: "other", label: "其他原因" };
}

function safeError(message: string | null) {
  return (message || "未记录具体原因").replace(/openapi_live_[A-Za-z0-9_-]+/gu, "[API_KEY]").slice(0, 240);
}

async function presentAdminJob(row: {
  job: typeof posterJobs.$inferSelect;
  email: string | null;
  name: string | null;
}) {
  let imageUrl: string | null = null;
  if (row.job.outputS3Uri) {
    const parsed = storage.tryParseS3Uri(row.job.outputS3Uri);
    if (parsed) imageUrl = (await storage.from(parsed.bucket).createPresignedGetUrl(parsed.path, 1800)).downloadUrl;
  }
  const category = row.job.errorCategory
    ? { key: row.job.errorCategory, label: failureCategory(row.job.errorMessage).label }
    : failureCategory(row.job.errorMessage);
  return {
    id: row.job.id,
    providerTaskId: row.job.providerTaskId,
    title: row.job.title,
    user: { id: row.job.userId, email: row.email, name: row.name },
    mode: row.job.mode,
    posterType: row.job.posterType,
    category: row.job.category,
    ratio: row.job.ratio,
    status: row.job.status,
    progress: row.job.progress,
    imageUrl,
    errorCategory: category.label,
    errorCode: row.job.errorCode,
    errorMessage: ["failed", "delayed"].includes(row.job.status) ? safeError(row.job.errorMessage) : null,
    retryable: row.job.retryable,
    attemptCount: row.job.attemptCount,
    createdAt: row.job.createdAt,
    updatedAt: row.job.updatedAt,
    completedAt: row.job.completedAt,
    durationMs: row.job.completedAt ? Math.max(0, row.job.completedAt - row.job.createdAt) : null,
  };
}

export const adminRoutes = new Hono()
  .get("/api/admin/overview", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const now = Date.now();
      const days = numberParam(c.req.query("days"), 14, 7, 30);
      const todayStart = beijingDayStart(now);
      const yesterdayStart = todayStart - DAY_MS;
      const historyStart = todayStart - (days - 1) * DAY_MS;
      const todayKey = beijingDayKey(now);
      const yesterdayKey = beijingDayKey(yesterdayStart);
      const dayKeys = recentBeijingDayKeys(days, now);
      const jobDay = sql<string>`date(${posterJobs.createdAt} / 1000, 'unixepoch', '+8 hours')`;
      const userDay = sql<string>`date(${esSystemAuthUser.createdAt} / 1000, 'unixepoch', '+8 hours')`;

      const [
        totalUsersRows,
        activeAccessRows,
        todayUsersRows,
        yesterdayUsersRows,
        todayJobsRows,
        yesterdayJobsRows,
        todayActivityRows,
        yesterdayActivityRows,
        revenueRows,
        todayRevenueRows,
        healthRows,
        jobTrendRows,
        userTrendRows,
        activityTrendRows,
        providerRows,
        creatorRows,
        failedRows,
        recentFailedRows,
      ] = await Promise.all([
        db.select({ value: count() }).from(esSystemAuthUser)
          .leftJoin(appProfiles, eq(appProfiles.userId, esSystemAuthUser.id)).where(nonAdminCondition()),
        db.select({ value: count() }).from(accessGrants)
          .leftJoin(appProfiles, eq(appProfiles.userId, accessGrants.userId)).where(and(nonAdminCondition(), activeAccessCondition(now))),
        db.select({ value: count() }).from(esSystemAuthUser)
          .leftJoin(appProfiles, eq(appProfiles.userId, esSystemAuthUser.id)).where(and(nonAdminCondition(), gte(esSystemAuthUser.createdAt, todayStart))),
        db.select({ value: count() }).from(esSystemAuthUser)
          .leftJoin(appProfiles, eq(appProfiles.userId, esSystemAuthUser.id)).where(and(nonAdminCondition(), gte(esSystemAuthUser.createdAt, yesterdayStart), lte(esSystemAuthUser.createdAt, todayStart - 1))),
        db.select({
          total: count(),
          completed: sql<number>`sum(case when ${posterJobs.status} = 'completed' then 1 else 0 end)`,
          failed: sql<number>`sum(case when ${posterJobs.status} = 'failed' then 1 else 0 end)`,
        }).from(posterJobs).where(gte(posterJobs.createdAt, todayStart)),
        db.select({
          total: count(),
          completed: sql<number>`sum(case when ${posterJobs.status} = 'completed' then 1 else 0 end)`,
          failed: sql<number>`sum(case when ${posterJobs.status} = 'failed' then 1 else 0 end)`,
        }).from(posterJobs).where(and(gte(posterJobs.createdAt, yesterdayStart), lte(posterJobs.createdAt, todayStart - 1))),
        db.select({ value: count() }).from(userDailyActivity)
          .innerJoin(appProfiles, eq(appProfiles.userId, userDailyActivity.userId)).where(and(eq(userDailyActivity.dayKey, todayKey), ne(appProfiles.role, "admin"))),
        db.select({ value: count() }).from(userDailyActivity)
          .innerJoin(appProfiles, eq(appProfiles.userId, userDailyActivity.userId)).where(and(eq(userDailyActivity.dayKey, yesterdayKey), ne(appProfiles.role, "admin"))),
        db.select({ value: sql<number>`coalesce(sum(${paymentOrders.amountFen}), 0)` }).from(paymentOrders).where(eq(paymentOrders.status, "paid")),
        db.select({ value: sql<number>`coalesce(sum(${paymentOrders.amountFen}), 0)` }).from(paymentOrders).where(and(eq(paymentOrders.status, "paid"), gte(paymentOrders.paidAt, todayStart))),
        db.select({
          queued: sql<number>`sum(case when ${posterJobs.status} = 'queued' then 1 else 0 end)`,
          submitting: sql<number>`sum(case when ${posterJobs.status} = 'submitting' then 1 else 0 end)`,
          processing: sql<number>`sum(case when ${posterJobs.status} = 'processing' then 1 else 0 end)`,
          delayed: sql<number>`sum(case when ${posterJobs.status} = 'delayed' then 1 else 0 end)`,
          stalled: sql<number>`sum(case when ${posterJobs.status} in ('queued', 'submitting', 'processing') and ${posterJobs.updatedAt} < ${now - 15 * 60 * 1000} then 1 else 0 end)`,
        }).from(posterJobs),
        db.select({
          day: jobDay,
          total: count(),
          completed: sql<number>`sum(case when ${posterJobs.status} = 'completed' then 1 else 0 end)`,
          failed: sql<number>`sum(case when ${posterJobs.status} = 'failed' then 1 else 0 end)`,
        }).from(posterJobs).where(gte(posterJobs.createdAt, historyStart)).groupBy(jobDay),
        db.select({ day: userDay, total: count() }).from(esSystemAuthUser)
          .leftJoin(appProfiles, eq(appProfiles.userId, esSystemAuthUser.id))
          .where(and(nonAdminCondition(), gte(esSystemAuthUser.createdAt, historyStart))).groupBy(userDay),
        db.select({ day: userDailyActivity.dayKey, total: count() }).from(userDailyActivity)
          .innerJoin(appProfiles, eq(appProfiles.userId, userDailyActivity.userId))
          .where(and(ne(appProfiles.role, "admin"), gte(userDailyActivity.dayKey, dayKeys[0]))).groupBy(userDailyActivity.dayKey),
        db.select({ userId: providerCredentials.userId, provider: providerCredentials.provider }).from(providerCredentials)
          .innerJoin(appProfiles, eq(appProfiles.userId, providerCredentials.userId))
          .where(and(eq(providerCredentials.status, "connected"), ne(appProfiles.role, "admin"))),
        db.select({ value: countDistinct(posterJobs.userId) }).from(posterJobs)
          .innerJoin(appProfiles, eq(appProfiles.userId, posterJobs.userId)).where(ne(appProfiles.role, "admin")),
        db.select({ errorMessage: posterJobs.errorMessage }).from(posterJobs)
          .where(and(eq(posterJobs.status, "failed"), gte(posterJobs.createdAt, now - 30 * DAY_MS))).orderBy(desc(posterJobs.createdAt)).limit(2000),
        db.select({ job: posterJobs, email: esSystemAuthUser.email, name: esSystemAuthUser.name }).from(posterJobs)
          .leftJoin(esSystemAuthUser, eq(esSystemAuthUser.id, posterJobs.userId))
          .where(eq(posterJobs.status, "failed")).orderBy(desc(posterJobs.updatedAt)).limit(6),
      ]);

      const todayJobs = todayJobsRows[0] || { total: 0, completed: 0, failed: 0 };
      const yesterdayJobs = yesterdayJobsRows[0] || { total: 0, completed: 0, failed: 0 };
      const jobTrendMap = new Map(jobTrendRows.map((item) => [item.day, item]));
      const userTrendMap = new Map(userTrendRows.map((item) => [item.day, Number(item.total || 0)]));
      const activityTrendMap = new Map(activityTrendRows.map((item) => [item.day, Number(item.total || 0)]));
      const providerMap = new Map<string, Set<string>>();
      for (const item of providerRows) {
        if (!providerMap.has(item.userId)) providerMap.set(item.userId, new Set());
        providerMap.get(item.userId)?.add(item.provider);
      }
      const failureMap = new Map<string, { key: string; label: string; count: number }>();
      for (const item of failedRows) {
        const category = failureCategory(item.errorMessage);
        const current = failureMap.get(category.key) || { ...category, count: 0 };
        current.count += 1;
        failureMap.set(category.key, current);
      }
      const totalUsers = Number(totalUsersRows[0]?.value || 0);
      const activeAccess = Number(activeAccessRows[0]?.value || 0);
      const configuredDeepseek = [...providerMap.values()].filter((items) => items.has("deepseek")).length;
      const configuredBoth = [...providerMap.values()].filter((items) => items.has("deepseek") && items.has("image2")).length;
      const creators = Number(creatorRows[0]?.value || 0);

      return c.json({
        ok: true,
        data: {
          generatedAt: now,
          timezone: "Asia/Shanghai",
          days,
          metrics: {
            totalUsers,
            activeAccess,
            newUsersToday: Number(todayUsersRows[0]?.value || 0),
            newUsersChange: percentChange(Number(todayUsersRows[0]?.value || 0), Number(yesterdayUsersRows[0]?.value || 0)),
            dauToday: Number(todayActivityRows[0]?.value || 0),
            dauChange: percentChange(Number(todayActivityRows[0]?.value || 0), Number(yesterdayActivityRows[0]?.value || 0)),
            generationsToday: Number(todayJobs.total || 0),
            generationsChange: percentChange(Number(todayJobs.total || 0), Number(yesterdayJobs.total || 0)),
            successRateToday: rate(Number(todayJobs.completed || 0), Number(todayJobs.failed || 0)),
            successRateChange: Math.round((rate(Number(todayJobs.completed || 0), Number(todayJobs.failed || 0)) - rate(Number(yesterdayJobs.completed || 0), Number(yesterdayJobs.failed || 0))) * 10) / 10,
            revenueTodayFen: Number(todayRevenueRows[0]?.value || 0),
            revenueTotalFen: Number(revenueRows[0]?.value || 0),
          },
          health: {
            queued: Number(healthRows[0]?.queued || 0),
            submitting: Number(healthRows[0]?.submitting || 0),
            processing: Number(healthRows[0]?.processing || 0),
            delayed: Number(healthRows[0]?.delayed || 0),
            stalled: Number(healthRows[0]?.stalled || 0),
            failedToday: Number(todayJobs.failed || 0),
          },
          funnel: [
            { key: "registered", label: "注册用户", value: totalUsers },
            { key: "activated", label: "已开通", value: activeAccess },
            { key: "deepseek", label: "已配 DeepSeek", value: configuredDeepseek },
            { key: "ready", label: "两项服务已配置", value: configuredBoth },
            { key: "created", label: "已生成过海报", value: creators },
          ],
          trend: dayKeys.map((day) => {
            const jobs = jobTrendMap.get(day);
            return {
              day,
              dau: activityTrendMap.get(day) || 0,
              newUsers: userTrendMap.get(day) || 0,
              generations: Number(jobs?.total || 0),
              completed: Number(jobs?.completed || 0),
              failed: Number(jobs?.failed || 0),
            };
          }),
          failures: [...failureMap.values()].sort((a, b) => b.count - a.count),
          recentFailures: await Promise.all(recentFailedRows.map(presentAdminJob)),
        },
      });
    } catch (error) { return fail(c, error); }
  })
  .get("/api/admin/users", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const { page, pageSize } = pageParams(c);
      const now = Date.now();
      const query = (c.req.query("query") || "").trim().slice(0, 100);
      const access = c.req.query("access") || "all";
      const provider = c.req.query("provider") || "all";
      const conditions: SQL[] = [];
      if (query) {
        const pattern = `%${query}%`;
        conditions.push(or(like(esSystemAuthUser.email, pattern), like(esSystemAuthUser.name, pattern), like(appProfiles.displayName, pattern)) as SQL);
      }
      if (access === "active") conditions.push(activeAccessCondition(now) as SQL);
      if (access === "inactive") conditions.push(or(isNull(accessGrants.userId), ne(accessGrants.status, "active"), lte(accessGrants.expiresAt, now)) as SQL);
      if (provider === "deepseek" || provider === "image2") {
        const providerUsers = await db.select({ userId: providerCredentials.userId }).from(providerCredentials)
          .where(and(eq(providerCredentials.provider, provider), eq(providerCredentials.status, "connected")));
        const ids = providerUsers.map((item) => item.userId);
        if (!ids.length) return c.json({ ok: true, data: { items: [], pagination: { page, pageSize, total: 0, totalPages: 0 } } });
        conditions.push(inArray(esSystemAuthUser.id, ids));
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const base = db.select({
        id: esSystemAuthUser.id,
        email: esSystemAuthUser.email,
        name: esSystemAuthUser.name,
        createdAt: esSystemAuthUser.createdAt,
        lastLoginAt: esSystemAuthUser.lastLoginAt,
        role: appProfiles.role,
        displayName: appProfiles.displayName,
        accessStatus: accessGrants.status,
        accessSource: accessGrants.source,
        accessExpiresAt: accessGrants.expiresAt,
      }).from(esSystemAuthUser)
        .leftJoin(appProfiles, eq(appProfiles.userId, esSystemAuthUser.id))
        .leftJoin(accessGrants, eq(accessGrants.userId, esSystemAuthUser.id));
      const [rows, totalRows] = await Promise.all([
        base.where(where).orderBy(desc(esSystemAuthUser.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
        db.select({ value: count() }).from(esSystemAuthUser)
          .leftJoin(appProfiles, eq(appProfiles.userId, esSystemAuthUser.id))
          .leftJoin(accessGrants, eq(accessGrants.userId, esSystemAuthUser.id)).where(where),
      ]);
      const ids = rows.map((item) => item.id);
      const [credentialRows, workRows, activityRows, paidRows] = ids.length ? await Promise.all([
        db.select({ userId: providerCredentials.userId, provider: providerCredentials.provider, status: providerCredentials.status })
          .from(providerCredentials).where(inArray(providerCredentials.userId, ids)),
        db.select({ userId: posterJobs.userId, total: count(), completed: sql<number>`sum(case when ${posterJobs.status} = 'completed' then 1 else 0 end)` })
          .from(posterJobs).where(inArray(posterJobs.userId, ids)).groupBy(posterJobs.userId),
        db.select({ userId: userDailyActivity.userId, lastSeenAt: max(userDailyActivity.lastSeenAt) })
          .from(userDailyActivity).where(inArray(userDailyActivity.userId, ids)).groupBy(userDailyActivity.userId),
        db.select({ userId: paymentOrders.userId, total: count() }).from(paymentOrders)
          .where(and(inArray(paymentOrders.userId, ids), eq(paymentOrders.status, "paid"))).groupBy(paymentOrders.userId),
      ]) : [[], [], [], []];
      const providerMap = new Map<string, string[]>();
      credentialRows.filter((item) => item.status === "connected").forEach((item) => providerMap.set(item.userId, [...(providerMap.get(item.userId) || []), item.provider]));
      const workMap = new Map(workRows.map((item) => [item.userId, { total: Number(item.total || 0), completed: Number(item.completed || 0) }]));
      const activityMap = new Map(activityRows.map((item) => [item.userId, Number(item.lastSeenAt || 0)]));
      const paidMap = new Map(paidRows.map((item) => [item.userId, Number(item.total || 0)]));
      const items = rows.map((item) => {
        const active = item.accessStatus === "active" && (item.accessExpiresAt === null || Number(item.accessExpiresAt || 0) > now);
        return {
          ...item,
          role: item.role || "user",
          accessStatus: active ? "active" : item.accessStatus === "active" ? "expired" : item.accessStatus || "pending",
          providers: providerMap.get(item.id) || [],
          works: workMap.get(item.id) || { total: 0, completed: 0 },
          lastActiveAt: activityMap.get(item.id) || item.lastLoginAt || null,
          paidOrderCount: paidMap.get(item.id) || 0,
        };
      });
      const total = Number(totalRows[0]?.value || 0);
      return c.json({ ok: true, data: { items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } });
    } catch (error) { return fail(c, error); }
  })
  .get("/api/admin/jobs", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const { page, pageSize } = pageParams(c);
      const query = (c.req.query("query") || "").trim().slice(0, 100);
      const status = c.req.query("status") || "all";
      const posterType = c.req.query("posterType") || "all";
      const category = c.req.query("category") || "all";
      const conditions: SQL[] = [];
      if (query) {
        const pattern = `%${query}%`;
        conditions.push(or(like(posterJobs.title, pattern), like(esSystemAuthUser.email, pattern), like(esSystemAuthUser.name, pattern), like(posterJobs.providerTaskId, pattern)) as SQL);
      }
      if (["queued", "submitting", "processing", "delayed", "completed", "failed"].includes(status)) conditions.push(eq(posterJobs.status, status));
      if (["生活类", "营销类"].includes(posterType)) conditions.push(eq(posterJobs.posterType, posterType));
      if (["生活分享", "观点表达", "课程推广", "产品推广"].includes(category)) conditions.push(eq(posterJobs.category, category));
      const where = conditions.length ? and(...conditions) : undefined;
      const [rows, totalRows] = await Promise.all([
        db.select({ job: posterJobs, email: esSystemAuthUser.email, name: esSystemAuthUser.name }).from(posterJobs)
          .leftJoin(esSystemAuthUser, eq(esSystemAuthUser.id, posterJobs.userId))
          .where(where).orderBy(desc(posterJobs.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
        db.select({ value: count() }).from(posterJobs)
          .leftJoin(esSystemAuthUser, eq(esSystemAuthUser.id, posterJobs.userId)).where(where),
      ]);
      const total = Number(totalRows[0]?.value || 0);
      return c.json({
        ok: true,
        data: {
          items: await Promise.all(rows.map(presentAdminJob)),
          pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
        },
      });
    } catch (error) { return fail(c, error); }
  })
  .get("/api/admin/invite-codes", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const rows = await db.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt)).limit(500);
      return c.json({ ok: true, data: { items: rows.map(safeInvite) } });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/admin/invite-codes", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const hmacKey = secret.get("INVITE_CODE_HMAC_KEY");
      if (!hmacKey) throw new AppError("NOT_CONFIGURED", "暗号服务尚未配置", 503);
      const body = await c.req.json<{ label?: string; maxUses?: number; expiresAt?: number | null }>().catch(() => ({} as { label?: string; maxUses?: number; expiresAt?: number | null }));
      const label = (body.label || "").trim();
      const maxUses = body.maxUses ?? 1;
      const expiresAt = body.expiresAt ?? null;
      if (label.length < 2 || label.length > 80) throw new AppError("INVALID_LABEL", "备注需为 2～80 个字符", 400);
      if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000) throw new AppError("INVALID_MAX_USES", "使用次数需为 1～10000", 400);
      if (expiresAt !== null && expiresAt <= Date.now()) throw new AppError("INVALID_EXPIRY", "过期时间必须晚于当前时间", 400);
      const code = randomCode();
      const now = Date.now();
      const invite = {
        id: crypto.randomUUID(),
        codeDigest: await digestInviteCode(code, hmacKey),
        label,
        status: "active",
        maxUses,
        usedCount: 0,
        expiresAt,
        createdBy: auth.user.id,
        createdAt: now,
        updatedAt: now,
      };
      await db.batch([
        db.insert(inviteCodes).values(invite),
        db.insert(auditLogs).values({
          id: crypto.randomUUID(), actorUserId: auth.user.id, action: "invite.created",
          targetType: "invite_code", targetId: invite.id,
          safeMetadataJson: JSON.stringify({ label, maxUses, expiresAt }), createdAt: now,
        }),
      ]);
      return c.json({ ok: true, data: { code, invite: safeInvite(invite) } }, 201);
    } catch (error) { return fail(c, error); }
  })
  .patch("/api/admin/invite-codes/:id", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const body = await c.req.json<{ status?: "active" | "disabled" }>().catch(() => ({} as { status?: "active" | "disabled" }));
      if (body.status !== "active" && body.status !== "disabled") throw new AppError("INVALID_STATUS", "暗号状态无效", 400);
      const [invite] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, c.req.param("id"))).limit(1);
      if (!invite) throw new AppError("NOT_FOUND", "没有找到这个暗号", 404);
      const updatedAt = Date.now();
      await db.update(inviteCodes).set({ status: body.status, updatedAt }).where(eq(inviteCodes.id, invite.id));
      return c.json({ ok: true, data: { invite: safeInvite({ ...invite, status: body.status, updatedAt }) } });
    } catch (error) { return fail(c, error); }
  })
  .patch("/api/admin/users/:id/access", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const userId = c.req.param("id");
      const body = await c.req.json<{ action?: "grant" | "revoke"; lifetime?: boolean }>().catch(() => ({} as { action?: "grant" | "revoke"; lifetime?: boolean }));
      if (body.action !== "grant" && body.action !== "revoke") throw new AppError("INVALID_ACTION", "授权操作无效", 400);
      const [targetUser] = await db.select({ id: esSystemAuthUser.id }).from(esSystemAuthUser).where(eq(esSystemAuthUser.id, userId)).limit(1);
      if (!targetUser) throw new AppError("USER_NOT_FOUND", "没有找到这个用户", 404);
      const [targetProfile] = await db.select({ role: appProfiles.role }).from(appProfiles).where(eq(appProfiles.userId, userId)).limit(1);
      if (body.action === "revoke" && (userId === auth.user.id || targetProfile?.role === "admin")) {
        throw new AppError("ADMIN_ACCESS_PROTECTED", "不能撤销管理员自己的访问权限", 409);
      }
      const now = Date.now();
      if (body.action === "grant") {
        await db.insert(accessGrants).values({
          userId, status: "active", source: "admin", grantedAt: now,
          expiresAt: body.lifetime ? null : now + 365 * DAY_MS,
          revokedAt: null, updatedAt: now,
        }).onConflictDoUpdate({
          target: accessGrants.userId,
          set: { status: "active", source: "admin", grantedAt: now, expiresAt: body.lifetime ? null : now + 365 * DAY_MS, revokedAt: null, updatedAt: now },
        });
      } else {
        await db.update(accessGrants).set({ status: "revoked", revokedAt: now, updatedAt: now }).where(eq(accessGrants.userId, userId));
      }
      await db.insert(auditLogs).values({
        id: crypto.randomUUID(), actorUserId: auth.user.id, action: `access.${body.action}`,
        targetType: "user", targetId: userId, safeMetadataJson: JSON.stringify({ lifetime: Boolean(body.lifetime) }), createdAt: now,
      });
      return c.json({ ok: true, data: { userId, status: body.action === "grant" ? "active" : "revoked" } });
    } catch (error) { return fail(c, error); }
  });
