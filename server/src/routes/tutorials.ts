import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { db, secret, vars } from "edgespark";
import { auth } from "edgespark/http";
import { auditLogs, onboardingTutorials } from "@defs";
import { AppError, requireActiveAccess, requireAdmin } from "../services/access";
import {
  createAliyunOssPresignedUrl,
  createAliyunOssUri,
  parseAliyunOssUri,
} from "../services/aliyunOss";

const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_DURATION_SECONDS = 24 * 60 * 60;
const UPLOAD_URL_TTL_SECONDS = 60 * 60;
const PLAY_URL_TTL_SECONDS = 60 * 60;

type TutorialRow = typeof onboardingTutorials.$inferSelect;

function fail(c: Context, error: unknown) {
  if (error instanceof AppError) {
    return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
  }
  console.error("Tutorial route error", error instanceof Error ? error.message : "unknown");
  return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "新手教学服务暂时不可用" } }, 500);
}

function cleanText(value: unknown, fieldName: string, minimum: number, maximum: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new AppError("INVALID_TUTORIAL", `${fieldName}需要填写 ${minimum}–${maximum} 个字`, 400);
  }
  return normalized;
}

function safeFileName(value: unknown) {
  const fileName = (typeof value === "string" ? value : "").split(/[\\/]/u).pop()?.trim() || "";
  if (!fileName || fileName.length > 180 || !fileName.toLowerCase().endsWith(".mp4")) {
    throw new AppError("INVALID_VIDEO", "请选择 MP4 格式的视频文件", 400);
  }
  return fileName;
}

function positiveInteger(value: unknown, name: string, maximum: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new AppError("INVALID_VIDEO", `${name}无效`, 400);
  }
  return parsed;
}

function optionalDuration(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Math.round(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_DURATION_SECONDS) {
    throw new AppError("INVALID_VIDEO", "视频时长无效", 400);
  }
  return parsed;
}

function ossSettings() {
  const bucket = (vars.get("ALIYUN_OSS_BUCKET") || "").trim();
  const region = (vars.get("ALIYUN_OSS_REGION") || "").trim();
  const prefix = (vars.get("ALIYUN_OSS_OBJECT_PREFIX") || "").trim().replace(/^\/+|\/+$/gu, "");
  const accessKeyId = (secret.get("ALIYUN_OSS_ACCESS_KEY_ID") || "").trim();
  const accessKeySecret = (secret.get("ALIYUN_OSS_ACCESS_KEY_SECRET") || "").trim();
  if (!bucket || !region || !prefix || !accessKeyId || !accessKeySecret) {
    throw new AppError("OSS_NOT_CONFIGURED", "新手教学视频存储尚未配置", 503);
  }
  return { bucket, region, prefix, accessKeyId, accessKeySecret };
}

function ossIsConfigured() {
  try {
    ossSettings();
    return true;
  } catch {
    return false;
  }
}

function objectKeyFor(row: TutorialRow, config: ReturnType<typeof ossSettings>) {
  const parsed = parseAliyunOssUri(row.ossUri);
  if (!parsed || parsed.bucket !== config.bucket || !parsed.objectKey.startsWith(`${config.prefix}/`)) {
    throw new AppError("INVALID_OSS_OBJECT", "教学视频存储记录无效", 500);
  }
  return parsed.objectKey;
}

async function playUrlFor(row: TutorialRow) {
  const config = ossSettings();
  return createAliyunOssPresignedUrl({
    ...config,
    method: "GET",
    objectKey: objectKeyFor(row, config),
    expiresInSeconds: PLAY_URL_TTL_SECONDS,
  });
}

function present(row: TutorialRow, playUrl: string | null = null) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    durationSeconds: row.durationSeconds,
    status: row.status,
    validationError: row.validationError,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    playUrl,
  };
}

export const tutorialRoutes = new Hono()
  .get("/api/tutorial", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [active] = await db.select().from(onboardingTutorials)
        .where(eq(onboardingTutorials.status, "active"))
        .orderBy(desc(onboardingTutorials.publishedAt))
        .limit(1);
      if (!active) return c.json({ ok: true, data: { tutorial: null } });
      return c.json({ ok: true, data: { tutorial: present(active, await playUrlFor(active)) } });
    } catch (error) {
      return fail(c, error);
    }
  })
  .get("/api/admin/tutorials", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const [rows, currentRows] = await Promise.all([
        db.select().from(onboardingTutorials)
          .orderBy(desc(onboardingTutorials.createdAt))
          .limit(50),
        db.select().from(onboardingTutorials)
          .where(eq(onboardingTutorials.status, "active"))
          .orderBy(desc(onboardingTutorials.publishedAt))
          .limit(1),
      ]);
      const current = currentRows[0] || null;
      const configured = ossIsConfigured();
      const items = current && !rows.some((row) => row.id === current.id) ? [current, ...rows] : rows;
      return c.json({
        ok: true,
        data: {
          ossConfigured: configured,
          current: current ? present(current, configured ? await playUrlFor(current) : null) : null,
          items: items.map((row) => present(row)),
        },
      });
    } catch (error) {
      return fail(c, error);
    }
  })
  .post("/api/admin/tutorials/uploads", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>()
        .catch(() => ({} as Record<string, unknown>));
      const title = cleanText(body.title, "教学标题", 2, 80);
      const description = cleanText(body.description, "教学说明", 0, 1200);
      const fileName = safeFileName(body.fileName);
      const sizeBytes = positiveInteger(body.sizeBytes, "视频大小", MAX_VIDEO_BYTES);
      const durationSeconds = optionalDuration(body.durationSeconds);
      const config = ossSettings();
      const id = crypto.randomUUID();
      const objectKey = `${config.prefix}/${id}/tutorial.mp4`;
      const now = Date.now();
      await db.insert(onboardingTutorials).values({
        id,
        createdBy: auth.user.id,
        title,
        description,
        ossUri: createAliyunOssUri(config.bucket, objectKey),
        fileName,
        contentType: "video/mp4",
        sizeBytes,
        durationSeconds,
        status: "uploading",
        validationError: null,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const uploadUrl = await createAliyunOssPresignedUrl({
        ...config,
        method: "PUT",
        objectKey,
        contentType: "video/mp4",
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      });
      return c.json({
        ok: true,
        data: {
          mode: "single",
          uploadId: id,
          uploadUrl,
          requiredHeaders: { "Content-Type": "video/mp4" },
          expiresAt: now + UPLOAD_URL_TTL_SECONDS * 1000,
        },
      });
    } catch (error) {
      return fail(c, error);
    }
  })
  .post("/api/admin/tutorials/:id/failure", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>()
        .catch(() => ({} as Record<string, unknown>));
      const message = cleanText(body.message, "失败原因", 1, 500);
      await db.update(onboardingTutorials).set({
        status: "failed",
        validationError: message,
        updatedAt: Date.now(),
      }).where(and(
        eq(onboardingTutorials.id, c.req.param("id")),
        eq(onboardingTutorials.createdBy, auth.user.id),
        eq(onboardingTutorials.status, "uploading"),
      ));
      return c.json({ ok: true, data: { recorded: true } });
    } catch (error) {
      return fail(c, error);
    }
  })
  .post("/api/admin/tutorials/:id/finalize", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireAdmin(auth.user.id);
      const [row] = await db.select().from(onboardingTutorials)
        .where(eq(onboardingTutorials.id, c.req.param("id")))
        .limit(1);
      if (!row) throw new AppError("TUTORIAL_NOT_FOUND", "没有找到这次上传记录", 404);
      if (row.status === "active") {
        return c.json({ ok: true, data: { tutorial: present(row, await playUrlFor(row)), alreadyPublished: true } });
      }
      if (!['uploading', 'failed'].includes(row.status)) {
        throw new AppError("TUTORIAL_NOT_PUBLISHABLE", "这个视频记录不能再次发布", 409);
      }
      const config = ossSettings();
      const headUrl = await createAliyunOssPresignedUrl({
        ...config,
        method: "HEAD",
        objectKey: objectKeyFor(row, config),
        expiresInSeconds: 5 * 60,
      });
      const response = await fetch(headUrl, { method: "HEAD", signal: AbortSignal.timeout(20_000) }).catch(() => null);
      const actualSize = response ? Number(response.headers.get("content-length")) : NaN;
      if (!response?.ok || !Number.isSafeInteger(actualSize) || actualSize !== row.sizeBytes) {
        const message = !response
          ? "暂时无法连接 OSS，请稍后重试发布"
          : response.status === 404
            ? "OSS 中没有找到完整视频，请重新上传"
            : response.status === 401 || response.status === 403
              ? "OSS 校验权限不足，请检查 RAM 权限后重试"
              : response.ok
                ? "视频大小校验不一致，请重新上传完整文件"
                : "OSS 未能确认视频完整性，请稍后重试";
        await db.update(onboardingTutorials).set({
          status: "failed",
          validationError: message,
          updatedAt: Date.now(),
        }).where(eq(onboardingTutorials.id, row.id));
        throw new AppError("OSS_VALIDATION_FAILED", message, response?.status === 404 ? 400 : 502);
      }
      const now = Date.now();
      await db.batch([
        db.update(onboardingTutorials).set({ status: "archived", updatedAt: now })
          .where(and(eq(onboardingTutorials.status, "active"), ne(onboardingTutorials.id, row.id))),
        db.update(onboardingTutorials).set({
          status: "active",
          validationError: null,
          publishedAt: now,
          updatedAt: now,
        }).where(and(eq(onboardingTutorials.id, row.id), inArray(onboardingTutorials.status, ["uploading", "failed"]))),
        db.insert(auditLogs).values({
          id: crypto.randomUUID(),
          actorUserId: auth.user.id,
          action: "tutorial.published",
          targetType: "onboarding_tutorial",
          targetId: row.id,
          safeMetadataJson: JSON.stringify({ sizeBytes: row.sizeBytes, durationSeconds: row.durationSeconds }),
          createdAt: now,
        }),
      ]);
      const published = { ...row, status: "active", validationError: null, publishedAt: now, updatedAt: now };
      return c.json({ ok: true, data: { tutorial: present(published, await playUrlFor(published)) } });
    } catch (error) {
      return fail(c, error);
    }
  });
