import { and, desc, eq, ne } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { db, storage, vars } from "edgespark";
import { auth } from "edgespark/http";
import { buckets, posterJobs, userReferenceAssets } from "@defs";
import { AppError, requireActiveAccess } from "../services/access";
import { getUserProviderKey } from "../services/credentials";
import { compilePosterPrompt } from "../services/image2";
import { createImage2BridgeEnvelope } from "../services/image2Bridge";
import { classifyJobFailure, GENERATION_TIMEOUT_MS, reconcileJobState, SUBMIT_TIMEOUT_MS } from "../services/jobState";

type ReferenceAsset = { path: string; role: string };
type ReferenceRole = "person" | "product" | "logo";

const REFERENCE_ROLES: Record<ReferenceRole, { label: string; fallbackName: string }> = {
  person: { label: "人物参考图", fallbackName: "person-reference" },
  product: { label: "产品或课程封面", fallbackName: "product-reference" },
  logo: { label: "品牌 Logo", fallbackName: "brand-logo" },
};

function fail(c: Context, error: unknown) {
  if (error instanceof AppError) return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
  console.error("Poster route error", error instanceof Error ? error.message : "unknown");
  return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "海报服务暂时不可用，请稍后重试" } }, 500);
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function image2Base() {
  return (vars.get("IMAGE2_API_BASE") || "https://openapi.yiminju.xyz/api/public/v1").replace(/\/+$/u, "");
}

function safeReferenceAssets(input: unknown, userId: string): ReferenceAsset[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => item && typeof item === "object" ? item as Record<string, unknown> : {})
    .map((item) => ({ path: String(item.path || ""), role: String(item.role || "参考图") }))
    .filter((item) => item.path.startsWith(`users/${userId}/references/`))
    .slice(0, 3);
}

function normalizeReferenceRole(value: unknown): ReferenceRole | null {
  const role = String(value || "").trim().toLowerCase();
  if (role === "person" || role.includes("人物")) return "person";
  if (role === "product" || role.includes("产品") || role.includes("课程")) return "product";
  if (role === "logo" || role.includes("logo")) return "logo";
  return null;
}

function contentTypeFromPath(path: string) {
  if (path.toLowerCase().endsWith(".jpg") || path.toLowerCase().endsWith(".jpeg")) return "image/jpeg";
  if (path.toLowerCase().endsWith(".webp")) return "image/webp";
  return "image/png";
}

async function presentSavedReference(asset: typeof userReferenceAssets.$inferSelect) {
  const signed = await storage.from(buckets.posterAssets).createPresignedGetUrl(asset.path, 3600);
  return {
    role: asset.role,
    path: asset.path,
    name: asset.fileName,
    contentType: asset.contentType,
    url: signed.downloadUrl,
    updatedAt: asset.updatedAt,
  };
}

async function referenceUrls(assets: ReferenceAsset[]) {
  const values = [];
  for (const asset of assets) {
    const signed = await storage.from(buckets.posterAssets).createPresignedGetUrl(asset.path, 3600);
    values.push(signed.downloadUrl);
  }
  return values;
}

function posterArchiveFetchUrl(remoteUrl: string) {
  const url = new URL(remoteUrl);
  if (url.hostname.toLowerCase() === "openapi.yiminju.xyz"
    && /^\/api\/public\/v1\/images\/results\/job_[A-Za-z0-9]+$/u.test(url.pathname)) {
    url.searchParams.set("direct", "1");
  }
  return url.toString();
}

async function persistCompletedPoster(jobId: string, userId: string, remoteUrl: string) {
  let stage = "fetch";
  let remoteHost = "invalid";
  try {
    remoteHost = new URL(remoteUrl).hostname;
    const response = await fetch(posterArchiveFetchUrl(remoteUrl), {
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.1" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`remote_http_${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 30 * 1024 * 1024) throw new Error("image_too_large");
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error("image_empty");
    if (bytes.byteLength > 30 * 1024 * 1024) throw new Error("image_too_large");
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "image/png";
    if (!contentType.startsWith("image/")) throw new Error(`invalid_content_type_${contentType}`);
    const extension = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
    const path = `users/${userId}/outputs/${jobId}.${extension}`;
    stage = "storage";
    await storage.from(buckets.posterAssets).put(path, bytes, {
      contentType,
      contentDisposition: `attachment; filename="pengyouquan-poster-${jobId.slice(0, 8)}.${extension}"`,
      cacheControl: "private, max-age=31536000",
    });
    const s3Uri = storage.createS3Uri(buckets.posterAssets, path);
    stage = "database";
    await db.update(posterJobs).set({ outputS3Uri: s3Uri, updatedAt: Date.now() })
      .where(and(eq(posterJobs.id, jobId), eq(posterJobs.userId, userId)));
    return true;
  } catch (error) {
    console.warn("Poster persistence deferred", {
      jobId,
      remoteHost,
      stage,
      error: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

function safeRemoteImageUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) return null;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/u.test(hostname)) return null;
    const private172 = hostname.match(/^172\.(\d{1,3})\./u);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return null;
    if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function bridgeForJob(job: typeof posterJobs.$inferSelect) {
  if (job.status === "completed" || job.status === "failed") return null;
  const apiKey = await getUserProviderKey(job.userId, "image2");
  const credential = await createImage2BridgeEnvelope(apiKey);
  const common = {
    baseUrl: image2Base(),
    envelope: credential.envelope,
    expiresAt: credential.expiresAt,
  };
  if (job.providerTaskId) {
    return { ...common, action: "poll", taskId: job.providerTaskId };
  }

  const input = safeJson<Record<string, unknown>>(job.inputJson, {});
  const plan = safeJson<Record<string, unknown>>(job.planJson, {});
  const assets = safeReferenceAssets(input.referenceAssets, job.userId);
  const imageUrls = await referenceUrls(assets);
  const prompt = compilePosterPrompt({
    mode: input.mode === "prompt" ? "prompt" : "copy",
    copy: String(input.copy || ""),
    posterType: job.posterType,
    category: job.category,
    ratio: job.ratio,
    qrPosition: String(plan.qrPosition || "不需要留白"),
    requiredCopy: Array.isArray(plan.requiredCopy) ? plan.requiredCopy : [],
    visualDirection: String(plan.visualDirection || ""),
    referenceRoles: assets.map((asset) => asset.role),
  });
  return {
    ...common,
    action: "submit",
    idempotencyKey: job.idempotencyKey,
    request: {
      model: "gpt-image-2",
      prompt,
      resolution: "1k",
      size: job.ratio,
      n: 1,
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    },
  };
}

async function presentJob(job: typeof posterJobs.$inferSelect, includeBridge = true) {
  let imageUrl = job.remoteImageUrl;
  if (job.outputS3Uri) {
    const parsed = storage.tryParseS3Uri(job.outputS3Uri);
    if (parsed) {
      const signed = await storage.from(parsed.bucket).createPresignedGetUrl(parsed.path, 3600);
      imageUrl = signed.downloadUrl;
    }
  }
  return {
    id: job.id,
    taskId: job.id,
    providerTaskId: job.providerTaskId,
    title: job.title,
    mode: job.mode,
    posterType: job.posterType,
    category: job.category,
    ratio: job.ratio,
    status: job.status,
    progress: job.progress,
    imageUrl,
    error: job.errorMessage,
    errorCode: job.errorCode,
    errorCategory: job.errorCategory,
    failureStage: job.failureStage,
    retryable: job.retryable,
    attemptCount: job.attemptCount,
    deadlineAt: job.deadlineAt,
    input: safeJson(job.inputJson, {}),
    plan: safeJson(job.planJson, {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    bridge: includeBridge ? await bridgeForJob(job) : null,
  };
}

export const posterRoutes = new Hono()
  .post("/api/assets/presign", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const body = await c.req.json<{ filename?: string; contentType?: string; sizeBytes?: number }>().catch(() => ({} as { filename?: string; contentType?: string; sizeBytes?: number }));
      const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
      const contentType = body.contentType || "";
      const sizeBytes = Number(body.sizeBytes || 0);
      if (!allowed.has(contentType)) throw new AppError("INVALID_FILE_TYPE", "请上传 PNG、JPG 或 WebP 图片", 400);
      if (!sizeBytes || sizeBytes > 12 * 1024 * 1024) throw new AppError("FILE_TOO_LARGE", "单张参考图不能超过 12MB", 400);
      const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
      const path = `users/${auth.user.id}/references/${crypto.randomUUID()}.${extension}`;
      const signed = await storage.from(buckets.posterAssets).createPresignedPutUrl(path, 900, { contentType });
      return c.json({ ok: true, data: { path, uploadUrl: signed.uploadUrl, requiredHeaders: signed.requiredHeaders, expiresAt: signed.expiresAt } });
    } catch (error) { return fail(c, error); }
  })
  .get("/api/assets/references", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      let rows = await db.select().from(userReferenceAssets)
        .where(eq(userReferenceAssets.userId, auth.user.id)).orderBy(desc(userReferenceAssets.updatedAt));

      const knownRoles = new Set(rows.map((row) => row.role));
      if (knownRoles.size < Object.keys(REFERENCE_ROLES).length) {
        const jobs = await db.select({ inputJson: posterJobs.inputJson }).from(posterJobs)
          .where(eq(posterJobs.userId, auth.user.id)).orderBy(desc(posterJobs.updatedAt)).limit(200);
        const recovered = new Map<ReferenceRole, ReferenceAsset>();
        for (const job of jobs) {
          const input = safeJson<{ referenceAssets?: ReferenceAsset[] }>(job.inputJson, {});
          for (const asset of safeReferenceAssets(input.referenceAssets, auth.user.id)) {
            const role = normalizeReferenceRole(asset.role);
            if (role && !knownRoles.has(role) && !recovered.has(role)) recovered.set(role, asset);
          }
        }
        for (const [role, asset] of recovered) {
          const metadata = await storage.from(buckets.posterAssets).head(asset.path);
          if (!metadata) continue;
          const now = Date.now();
          const extension = asset.path.split(".").pop() || "png";
          await db.insert(userReferenceAssets).values({
            id: crypto.randomUUID(), userId: auth.user.id, role, path: asset.path,
            fileName: `${REFERENCE_ROLES[role].fallbackName}.${extension}`,
            contentType: metadata.contentType || contentTypeFromPath(asset.path),
            createdAt: now, updatedAt: now,
          }).onConflictDoNothing();
        }
        rows = await db.select().from(userReferenceAssets)
          .where(eq(userReferenceAssets.userId, auth.user.id)).orderBy(desc(userReferenceAssets.updatedAt));
      }

      const data: Partial<Record<ReferenceRole, Awaited<ReturnType<typeof presentSavedReference>>>> = {};
      for (const row of rows) {
        const role = normalizeReferenceRole(row.role);
        if (!role || data[role]) continue;
        const metadata = await storage.from(buckets.posterAssets).head(row.path);
        if (metadata) data[role] = await presentSavedReference(row);
      }
      return c.json({ ok: true, data });
    } catch (error) { return fail(c, error); }
  })
  .put("/api/assets/references/:role", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const role = normalizeReferenceRole(c.req.param("role"));
      if (!role) throw new AppError("INVALID_REFERENCE_ROLE", "参考素材类型无效", 400);
      const body = await c.req.json<{ path?: string; fileName?: string; contentType?: string }>()
        .catch(() => ({} as { path?: string; fileName?: string; contentType?: string }));
      const path = String(body.path || "");
      if (!path.startsWith(`users/${auth.user.id}/references/`)) {
        throw new AppError("INVALID_REFERENCE_PATH", "参考素材路径无效", 400);
      }
      const metadata = await storage.from(buckets.posterAssets).head(path);
      if (!metadata) throw new AppError("REFERENCE_NOT_UPLOADED", "参考图尚未上传完成，请重试", 409);
      const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
      const contentType = allowed.has(String(body.contentType))
        ? String(body.contentType)
        : metadata.contentType || contentTypeFromPath(path);
      const fileName = String(body.fileName || REFERENCE_ROLES[role].fallbackName).trim().slice(0, 180);
      const now = Date.now();
      await db.insert(userReferenceAssets).values({
        id: crypto.randomUUID(), userId: auth.user.id, role, path, fileName, contentType,
        createdAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: [userReferenceAssets.userId, userReferenceAssets.role],
        set: { path, fileName, contentType, updatedAt: now },
      });
      const [saved] = await db.select().from(userReferenceAssets)
        .where(and(eq(userReferenceAssets.userId, auth.user.id), eq(userReferenceAssets.role, role))).limit(1);
      return c.json({ ok: true, data: await presentSavedReference(saved) });
    } catch (error) { return fail(c, error); }
  })
  .delete("/api/assets/references/:role", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const role = normalizeReferenceRole(c.req.param("role"));
      if (!role) throw new AppError("INVALID_REFERENCE_ROLE", "参考素材类型无效", 400);
      await db.delete(userReferenceAssets)
        .where(and(eq(userReferenceAssets.userId, auth.user.id), eq(userReferenceAssets.role, role)));
      return c.json({ ok: true, data: { deleted: true, role } });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/image/generations", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const input = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      const copy = String(input.copy || "").trim();
      if (!copy) throw new AppError("COPY_REQUIRED", "请先输入朋友圈文案或图片要求", 400);
      if (copy.length > 2000) throw new AppError("COPY_TOO_LONG", "输入内容不能超过 2000 个字符", 400);
      const ratio = ["1:1", "3:4", "9:16", "16:9"].includes(String(input.ratio)) ? String(input.ratio) : "3:4";
      const suppliedIdempotencyKey = String(input.idempotencyKey || "").trim();
      const idempotencyKey = suppliedIdempotencyKey || crypto.randomUUID();
      if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)) {
        throw new AppError("INVALID_IDEMPOTENCY_KEY", "请求标识格式无效，请重新提交", 400);
      }
      const [existing] = await db.select().from(posterJobs)
        .where(and(eq(posterJobs.userId, auth.user.id), eq(posterJobs.idempotencyKey, idempotencyKey))).limit(1);
      if (existing) return c.json({ ok: true, data: await presentJob(existing) });
      const assets = safeReferenceAssets(input.referenceAssets, auth.user.id);
      await getUserProviderKey(auth.user.id, "image2");
      const posterType = input.posterType === "营销类" ? "营销类" : "生活类";
      const categories = new Set(["生活分享", "观点表达", "课程推广", "产品推广"]);
      const category = categories.has(String(input.category)) ? String(input.category) : posterType === "营销类" ? "产品推广" : "生活分享";
      const qrPositions = new Set(["右下角", "左下角", "右侧中部", "不需要留白"]);
      const qrPosition = qrPositions.has(String(input.qrPosition)) ? String(input.qrPosition) : posterType === "营销类" ? "右下角" : "不需要留白";
      const requiredCopy = Array.isArray(input.requiredCopy)
        ? input.requiredCopy.map((item) => String(item).trim().slice(0, 160)).filter(Boolean).slice(0, 4)
        : [];
      const visualDirection = String(input.visualDirection || "").trim().slice(0, 1000);
      const mode = input.mode === "prompt" ? "prompt" : "copy";
      const now = Date.now();
      const title = String(requiredCopy[0] || copy).slice(0, 28) || "新海报";
      const safeInput = {
        mode,
        copy: copy.slice(0, 2000),
        referenceAssets: assets,
      };
      const safePlan = {
        posterType,
        category,
        ratio,
        qrPosition,
        visualDirection,
        requiredCopy,
      };
      const [job] = await db.insert(posterJobs).values({
        id: crypto.randomUUID(), userId: auth.user.id, idempotencyKey,
        providerTaskId: null, title, mode: String(safeInput.mode),
        posterType: safePlan.posterType, category: safePlan.category, ratio,
        status: "submitting", progress: 16, inputJson: JSON.stringify(safeInput),
        planJson: JSON.stringify(safePlan), retryable: true, attemptCount: 1,
        lastAttemptAt: now, deadlineAt: now + SUBMIT_TIMEOUT_MS, createdAt: now, updatedAt: now,
      }).returning();
      return c.json({ ok: true, data: await presentJob(job) }, 202);
    } catch (error) { return fail(c, error); }
  })
  .post("/api/image/tasks/:id/accept", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [job] = await db.select().from(posterJobs)
        .where(and(eq(posterJobs.id, c.req.param("id")), eq(posterJobs.userId, auth.user.id))).limit(1);
      if (!job) throw new AppError("WORK_NOT_FOUND", "没有找到这个生成任务", 404);
      const body = await c.req.json<{ taskId?: string }>().catch(() => ({} as { taskId?: string }));
      const taskId = String(body.taskId || "").trim();
      if (!/^[A-Za-z0-9._:-]{6,200}$/u.test(taskId)) throw new AppError("INVALID_TASK_ID", "Image2 返回的任务编号无效", 400);
      if (job.providerTaskId && job.providerTaskId !== taskId) {
        throw new AppError("TASK_ID_CONFLICT", "这个生成任务已绑定其他上游编号", 409);
      }
      if (job.status === "completed" || job.status === "failed" || job.providerTaskId === taskId) {
        return c.json({ ok: true, data: await presentJob(job) });
      }
      const now = Date.now();
      const [updated] = await db.update(posterJobs).set({
        providerTaskId: taskId,
        status: "processing",
        progress: Math.max(job.progress, 24),
        errorCode: null,
        errorCategory: null,
        failureStage: null,
        errorMessage: null,
        retryable: true,
        deadlineAt: now + GENERATION_TIMEOUT_MS,
        updatedAt: now,
      }).where(and(eq(posterJobs.id, job.id), eq(posterJobs.userId, auth.user.id))).returning();
      return c.json({ ok: true, data: await presentJob(updated) });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/image/tasks/:id/sync", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [job] = await db.select().from(posterJobs)
        .where(and(eq(posterJobs.id, c.req.param("id")), eq(posterJobs.userId, auth.user.id))).limit(1);
      if (!job) throw new AppError("WORK_NOT_FOUND", "没有找到这个生成任务", 404);
      if (job.status === "completed") return c.json({ ok: true, data: await presentJob(job) });
      const body = await c.req.json<{ taskId?: string; status?: string; progress?: number; imageUrl?: string | null; archiveUrl?: string | null; error?: string | null }>()
        .catch(() => ({} as { taskId?: string; status?: string; progress?: number; imageUrl?: string | null; archiveUrl?: string | null; error?: string | null }));
      const taskId = String(body.taskId || "").trim();
      if (!job.providerTaskId || taskId !== job.providerTaskId) throw new AppError("TASK_ID_CONFLICT", "生成任务编号不匹配", 409);
      const rawStatus = String(body.status || "processing").toLowerCase();
      const imageUrl = safeRemoteImageUrl(body.imageUrl);
      const archiveUrl = safeRemoteImageUrl(body.archiveUrl);
      const completed = ["completed", "complete", "succeeded", "success", "done", "finished"].includes(rawStatus) || Boolean(imageUrl);
      const failed = ["failed", "failure", "error", "rejected", "cancelled", "canceled"].includes(rawStatus);
      const status = completed ? "completed" : failed ? "failed" : "processing";
      if (completed && !imageUrl) throw new AppError("INVALID_IMAGE_URL", "Image2 已完成，但结果图地址无效", 400);
      const progressInput = Number(body.progress || 0);
      const progress = completed ? 100 : failed ? Math.max(job.progress, 24)
        : Math.max(job.progress, Math.min(95, Number.isFinite(progressInput) && progressInput > 0 ? progressInput : 36));
      const now = Date.now();
      const failure = failed ? classifyJobFailure({ message: body.error, stage: "poll" }) : null;
      const [updated] = await db.update(posterJobs).set({
        status: failure?.delayed ? "delayed" : status,
        progress,
        remoteImageUrl: imageUrl || job.remoteImageUrl,
        errorMessage: failure?.message || null,
        errorCode: failure?.code || null,
        errorCategory: failure?.category || null,
        failureStage: failure?.stage || null,
        retryable: failure?.retryable ?? true,
        completedAt: completed ? now : null,
        updatedAt: now,
      }).where(and(eq(posterJobs.id, job.id), eq(posterJobs.userId, auth.user.id))).returning();
      if (completed && imageUrl && !updated.outputS3Uri) {
        await persistCompletedPoster(job.id, auth.user.id, archiveUrl || imageUrl);
      }
      return c.json({ ok: true, data: await presentJob(updated) });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/image/tasks/:id/failure", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [job] = await db.select().from(posterJobs)
        .where(and(eq(posterJobs.id, c.req.param("id")), eq(posterJobs.userId, auth.user.id))).limit(1);
      if (!job) throw new AppError("WORK_NOT_FOUND", "没有找到这个生成任务", 404);
      if (job.status === "completed") return c.json({ ok: true, data: await presentJob(job) });
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
      const failure = classifyJobFailure(body);
      const now = Date.now();
      const [updated] = await db.update(posterJobs).set({
        status: failure.delayed ? "delayed" : "failed",
        errorCode: failure.code,
        errorCategory: failure.category,
        failureStage: failure.stage,
        errorMessage: failure.message,
        retryable: failure.retryable,
        updatedAt: now,
      }).where(and(eq(posterJobs.id, job.id), eq(posterJobs.userId, auth.user.id))).returning();
      return c.json({ ok: true, data: await presentJob(updated) });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/image/tasks/:id/retry", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [job] = await db.select().from(posterJobs)
        .where(and(eq(posterJobs.id, c.req.param("id")), eq(posterJobs.userId, auth.user.id))).limit(1);
      if (!job) throw new AppError("WORK_NOT_FOUND", "没有找到这个生成任务", 404);
      if (job.status === "completed") return c.json({ ok: true, data: await presentJob(job) });
      if (!job.retryable) throw new AppError("JOB_NOT_RETRYABLE", job.errorMessage || "请先修正服务配置或生成要求", 409);
      const now = Date.now();
      const [updated] = await db.update(posterJobs).set({
        status: job.providerTaskId ? "processing" : "submitting",
        progress: job.providerTaskId ? Math.max(job.progress, 24) : 16,
        errorCode: null,
        errorCategory: null,
        failureStage: null,
        errorMessage: null,
        retryable: true,
        attemptCount: Math.max(1, job.attemptCount || 1) + 1,
        lastAttemptAt: now,
        deadlineAt: now + (job.providerTaskId ? GENERATION_TIMEOUT_MS : SUBMIT_TIMEOUT_MS),
        updatedAt: now,
      }).where(and(eq(posterJobs.id, job.id), eq(posterJobs.userId, auth.user.id))).returning();
      return c.json({ ok: true, data: await presentJob(updated) });
    } catch (error) { return fail(c, error); }
  })
  .get("/api/image/tasks/:id", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [job] = await db.select().from(posterJobs)
        .where(and(eq(posterJobs.id, c.req.param("id")), eq(posterJobs.userId, auth.user.id))).limit(1);
      if (!job) throw new AppError("WORK_NOT_FOUND", "没有找到这个生成任务", 404);
      return c.json({ ok: true, data: await presentJob(await reconcileJobState(job)) });
    } catch (error) { return fail(c, error); }
  })
  .get("/api/works", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const rows = await db.select().from(posterJobs).where(eq(posterJobs.userId, auth.user.id)).orderBy(desc(posterJobs.updatedAt)).limit(200);
      const reconciled = await Promise.all(rows.map(reconcileJobState));
      return c.json({ ok: true, data: await Promise.all(reconciled.map((job) => presentJob(job, false))) });
    } catch (error) { return fail(c, error); }
  })
  .get("/api/works/:id/download", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      let [job] = await db.select().from(posterJobs)
        .where(and(eq(posterJobs.id, c.req.param("id")), eq(posterJobs.userId, auth.user.id))).limit(1);
      if (!job) throw new AppError("WORK_NOT_FOUND", "没有找到这张海报", 404);
      if (job.status !== "completed") throw new AppError("WORK_NOT_READY", "海报还在生成，完成后才能下载", 409);
      if (!job.outputS3Uri && job.remoteImageUrl) {
        await persistCompletedPoster(job.id, auth.user.id, job.remoteImageUrl);
        [job] = await db.select().from(posterJobs)
          .where(and(eq(posterJobs.id, job.id), eq(posterJobs.userId, auth.user.id))).limit(1);
      }
      const parsed = job.outputS3Uri ? storage.tryParseS3Uri(job.outputS3Uri) : null;
      if (!parsed) throw new AppError("POSTER_NOT_STORED", "高清图正在保存，请稍后重试", 503);
      const object = await storage.from(parsed.bucket).get(parsed.path);
      if (!object) throw new AppError("POSTER_FILE_MISSING", "高清图文件暂时不可用，请稍后重试", 503);
      const extension = parsed.path.split(".").pop() || "png";
      const contentDisposition = `attachment; filename="pengyouquan-poster-${job.id.slice(0, 8)}.${extension}"`;
      if (object.metadata.contentDisposition !== contentDisposition) {
        await storage.from(parsed.bucket).put(parsed.path, object.body, {
          contentType: object.metadata.contentType || contentTypeFromPath(parsed.path),
          contentDisposition,
          cacheControl: object.metadata.cacheControl || "private, max-age=31536000",
        });
      }
      const signed = await storage.from(parsed.bucket).createPresignedGetUrl(parsed.path, 300);
      return c.json({ ok: true, data: { downloadUrl: signed.downloadUrl } });
    } catch (error) { return fail(c, error); }
  })
  .delete("/api/works/:id", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [job] = await db.select().from(posterJobs)
        .where(and(eq(posterJobs.id, c.req.param("id")), eq(posterJobs.userId, auth.user.id))).limit(1);
      if (!job) throw new AppError("WORK_NOT_FOUND", "这个作品已经不存在", 404);
      const paths: string[] = [];
      if (job.outputS3Uri) {
        const parsed = storage.tryParseS3Uri(job.outputS3Uri);
        if (parsed) paths.push(parsed.path);
      }
      const input = safeJson<{ referenceAssets?: ReferenceAsset[] }>(job.inputJson, {});
      const otherJobs = await db.select({ inputJson: posterJobs.inputJson }).from(posterJobs)
        .where(and(eq(posterJobs.userId, auth.user.id), ne(posterJobs.id, job.id)));
      const sharedReferencePaths = new Set(otherJobs.flatMap((item) => {
        const otherInput = safeJson<{ referenceAssets?: ReferenceAsset[] }>(item.inputJson, {});
        return (otherInput.referenceAssets || []).map((asset) => asset.path);
      }));
      const savedReferenceRows = await db.select({ path: userReferenceAssets.path }).from(userReferenceAssets)
        .where(eq(userReferenceAssets.userId, auth.user.id));
      const savedReferencePaths = new Set(savedReferenceRows.map((item) => item.path));
      for (const asset of input.referenceAssets || []) {
        if (asset.path.startsWith(`users/${auth.user.id}/references/`)
          && !sharedReferencePaths.has(asset.path) && !savedReferencePaths.has(asset.path)) paths.push(asset.path);
      }
      if (paths.length) await storage.from(buckets.posterAssets).delete(paths);
      await db.delete(posterJobs).where(and(eq(posterJobs.id, job.id), eq(posterJobs.userId, auth.user.id)));
      return c.json({ ok: true, data: { deleted: true, id: job.id } });
    } catch (error) { return fail(c, error); }
  });
