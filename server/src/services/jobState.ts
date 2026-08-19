import { and, eq } from "drizzle-orm";
import { db } from "edgespark";
import { posterJobs } from "@defs";

export const SUBMIT_TIMEOUT_MS = 3 * 60 * 1000;
export const GENERATION_TIMEOUT_MS = 20 * 60 * 1000;

export type FailureStage = "upload" | "submit" | "poll" | "save" | "unknown";

type FailureInput = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  stage?: unknown;
};

export type FailureDetails = {
  code: string;
  category: string;
  stage: FailureStage;
  message: string;
  retryable: boolean;
  delayed: boolean;
};

function safeMessage(value: unknown) {
  return String(value || "")
    .replace(/openapi_live_[A-Za-z0-9_-]+/gu, "[API_KEY]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/gu, "[API_KEY]")
    .slice(0, 500);
}

function stageValue(value: unknown): FailureStage {
  return ["upload", "submit", "poll", "save"].includes(String(value)) ? String(value) as FailureStage : "unknown";
}

export function classifyJobFailure(input: FailureInput): FailureDetails {
  const rawCode = String(input.code || "").toUpperCase();
  const rawMessage = safeMessage(input.message);
  const searchable = `${rawCode} ${rawMessage}`.toLowerCase();
  const status = Number(input.status || 0);
  const stage = stageValue(input.stage);

  if (rawCode === "SUBMIT_TIMEOUT") return { code: rawCode, category: "timeout", stage: "submit", message: "提交 Image2 超过预期时间，已停止自动等待。可以安全重试，不会重复创建同一订单。", retryable: true, delayed: true };
  if (rawCode === "POLL_TIMEOUT") return { code: rawCode, category: "timeout", stage: "poll", message: "Image2 暂未返回最终结果，已停止自动查询。继续查询原任务不会重复扣费。", retryable: true, delayed: true };
  if (/BRIDGE_ORIGIN|ORIGIN_NOT_ALLOWED/u.test(rawCode)) {
    return { code: rawCode, category: "bridge", stage, message: "当前访问域名暂未通过 Image2 安全连接校验，任务已保留，请联系管理员处理。", retryable: true, delayed: true };
  }
  if (/BRIDGE|MISSING_TASK_ID/u.test(rawCode)) {
    return { code: rawCode, category: "bridge", stage, message: rawCode === "MISSING_TASK_ID" ? "Image2 已接收请求但没有返回任务编号，任务已保留，可以安全重试。" : "Image2 安全连接暂时不可用，任务已保留，请稍后继续。", retryable: true, delayed: true };
  }
  if (status === 401 || status === 403 || /unauthenticated|unauthorized|api.?key|鉴权|密钥|key 无效|invalid key/u.test(searchable)) {
    return { code: rawCode || "IMAGE2_AUTH", category: "authentication", stage, message: "Image2 Key 无效、已停用或没有调用权限，请到服务设置中检查后重试。", retryable: false, delayed: false };
  }
  if (status === 402 || /余额|insufficient|balance|充值/u.test(searchable)) {
    return { code: rawCode || "IMAGE2_BALANCE", category: "balance", stage, message: "Image2 账户余额不足，请充值后再生成。", retryable: false, delayed: false };
  }
  if (status === 429 || /rate.?limit|too many|频率|限流/u.test(searchable)) {
    return { code: rawCode || "RATE_LIMIT", category: "rate_limit", stage, message: "Image2 当前请求较多，任务已暂停自动重试，请稍后继续。", retryable: true, delayed: true };
  }
  if (/moderation|content policy|内容安全|审核|违规|rejected/u.test(searchable)) {
    return { code: rawCode || "CONTENT_REJECTED", category: "content", stage, message: "图片要求未通过内容安全检查，请修改可能涉及敏感或违规的内容后重新生成。", retryable: false, delayed: false };
  }
  if (status === 400 || /invalid|参数|格式|resolution|size/u.test(searchable)) {
    return { code: rawCode || "INVALID_REQUEST", category: "request", stage, message: "生成参数未被 Image2 接受，请修改图片要求或参考素材后重新生成。", retryable: false, delayed: false };
  }
  if (status >= 500 || /network|fetch|连接|超时|timeout|temporar|service unavailable|522/u.test(searchable)) {
    return { code: rawCode || "PROVIDER_UNAVAILABLE", category: "provider", stage, message: "Image2 服务暂时不可连接，任务已保留，请稍后继续。", retryable: true, delayed: true };
  }
  return {
    code: rawCode || "GENERATION_FAILED",
    category: "unknown",
    stage,
    message: rawMessage || "Image2 没有完成这次生成，请检查要求后重试。",
    retryable: true,
    delayed: false,
  };
}

export async function reconcileJobState(job: typeof posterJobs.$inferSelect) {
  if (!["queued", "submitting", "processing"].includes(job.status)) return job;
  const now = Date.now();
  const defaultDeadline = job.providerTaskId
    ? job.createdAt + GENERATION_TIMEOUT_MS
    : job.createdAt + SUBMIT_TIMEOUT_MS;
  if ((job.deadlineAt || defaultDeadline) > now) return job;
  const failure = classifyJobFailure({
    code: job.providerTaskId ? "POLL_TIMEOUT" : "SUBMIT_TIMEOUT",
    stage: job.providerTaskId ? "poll" : "submit",
  });
  const [updated] = await db.update(posterJobs).set({
    status: "delayed",
    errorCode: failure.code,
    errorCategory: failure.category,
    failureStage: failure.stage,
    errorMessage: failure.message,
    retryable: failure.retryable,
    updatedAt: now,
  }).where(and(eq(posterJobs.id, job.id), eq(posterJobs.userId, job.userId))).returning();
  return updated || job;
}
