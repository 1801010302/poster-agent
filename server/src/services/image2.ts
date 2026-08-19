import { AppError } from "./access";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function findTaskId(data: JsonRecord): string | null {
  const nested = [asRecord(data.data), asRecord(data.result), asRecord(data.output)];
  return stringValue(data.task_id) || stringValue(data.taskId) || stringValue(data.id)
    || nested.map((item) => stringValue(item.task_id) || stringValue(item.taskId) || stringValue(item.id)).find(Boolean) || null;
}

function findImageUrl(data: JsonRecord): string | null {
  const nested = [asRecord(data.data), asRecord(data.result), asRecord(data.output)];
  const direct = [data.image_url, data.imageUrl, data.result_url, data.resultUrl, data.output_url, data.outputUrl, data.url];
  const arrays = [data.images, data.urls, data.result_urls, ...nested.flatMap((item) => [item.images, item.urls, item.result_urls])];
  for (const candidate of [...direct, ...nested.flatMap((item) => [item.image_url, item.imageUrl, item.url])]) {
    const url = stringValue(candidate);
    if (url?.startsWith("http")) return url;
  }
  for (const candidate of arrays) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      const url = stringValue(item) || stringValue(asRecord(item).url) || stringValue(asRecord(item).image_url);
      if (url?.startsWith("http")) return url;
    }
  }
  return null;
}

async function request(apiKey: string, apiBase: string, pathname: string, init?: RequestInit): Promise<JsonRecord> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(`${apiBase}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(init?.method === "POST" ? 60_000 : 30_000),
    }).catch(() => null);
    if (response && response.status < 500) break;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  if (!response) throw new AppError("IMAGE2_UNAVAILABLE", "Image2 暂时无法连接，请稍后重试", 503);
  const data = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const upstreamError = asRecord(data.error);
    const upstreamMessage = stringValue(upstreamError.message) || stringValue(data.message);
    const message = response.status === 401 || response.status === 403
      ? "Image2 API Key 无效，请在服务设置中重新填写"
      : response.status === 402 ? "Image2 账户余额不足，请充值后重试"
        : response.status === 429 ? "Image2 当前请求过多或额度受限，请稍后重试"
          : upstreamMessage || `Image2 请求失败（${response.status}）`;
    throw new AppError(`IMAGE2_${response.status}`, message, response.status === 401 ? 400 : 502);
  }
  return data;
}

export async function createImage2Task(
  apiKey: string,
  apiBase: string,
  input: { prompt: string; ratio: string; imageUrls: string[]; idempotencyKey: string },
) {
  const data = await request(apiKey, apiBase, "/images/generations", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: input.prompt,
      resolution: "1k",
      size: input.ratio,
      n: 1,
      ...(input.imageUrls.length ? { image_urls: input.imageUrls } : {}),
    }),
  });
  const taskId = findTaskId(data);
  if (!taskId) throw new AppError("IMAGE2_INVALID_RESPONSE", "Image2 已接收请求，但没有返回任务编号", 502);
  return { taskId };
}

export async function getImage2Task(apiKey: string, apiBase: string, taskId: string) {
  const data = await request(apiKey, apiBase, `/tasks/${encodeURIComponent(taskId)}`, { method: "GET" });
  const statusRaw = String(data.status || data.state || asRecord(data.data).status || asRecord(data.data).state || "processing").toLowerCase();
  const imageUrl = findImageUrl(data);
  const completed = ["completed", "complete", "succeeded", "success", "done", "finished"].includes(statusRaw) || Boolean(imageUrl);
  const failed = ["failed", "failure", "error", "rejected", "cancelled", "canceled"].includes(statusRaw);
  const progressRaw = Number(data.progress || asRecord(data.data).progress || 0);
  return {
    status: completed ? "completed" : failed ? "failed" : "processing",
    progress: completed ? 100 : Math.max(12, Math.min(95, Number.isFinite(progressRaw) && progressRaw > 0 ? progressRaw : 36)),
    imageUrl,
    error: failed ? stringValue(asRecord(data.error).message) || stringValue(data.message) || "Image2 生成失败" : null,
  };
}

export function compilePosterPrompt(input: Record<string, unknown>) {
  const references = Array.isArray(input.referenceRoles) ? input.referenceRoles.map((item) => String(item).slice(0, 80)).slice(0, 3) : [];
  const requiredCopy = Array.isArray(input.requiredCopy) ? input.requiredCopy.map((item) => String(item).slice(0, 160)).filter(Boolean).slice(0, 4) : [];
  const qrPosition = String(input.qrPosition || "不需要留白");
  const qrInstruction = qrPosition === "不需要留白"
    ? "不要放置二维码，也不需要预留二维码区域。"
    : `在画面${qrPosition}预留一个干净、规则、对比清楚的空白区域，供用户后续自行贴入二维码。只留空白，不要生成二维码图案、定位点或假二维码。`;
  const referenceInstruction = references.length
    ? `参考图按上传顺序分别是：${references.map((role, index) => `第${index + 1}张是${role}`).join("；")}。严格保持人物身份特征、产品外观和 Logo 形态，不要互相混用。`
    : "没有提供参考图，请根据文案创造合适的原创画面。";
  return [
    "请创建一张可直接发布到微信朋友圈的完整成品海报。",
    "这是一次性生成任务：必须在同一张最终图片中完成场景、人物或产品、中文文字、排版、装饰和整体视觉，不能只生成无字底图，也不能依赖后续本地叠字或二次合成。",
    `内容类型：${String(input.category || "生活分享")}。输出比例：${String(input.ratio || "3:4")}。`,
    `${input.mode === "prompt" ? "用户的明确画面要求" : "用户准备发布的朋友圈文案"}：\n${String(input.copy || "").trim().slice(0, 2000)}`,
    `视觉方向：${String(input.visualDirection || "真实自然、主体明确、适合中文社交媒体传播。").trim().slice(0, 1000)}`,
    requiredCopy.length ? `以下中文必须准确、清晰、完整出现，禁止错字、漏字、拆字和替换：${requiredCopy.map((text) => `「${text}」`).join("、")}。` : "控制文字数量，保证中文清晰。",
    qrInstruction,
    referenceInstruction,
    "排版要有明确的信息层级和安全边距，手机屏幕缩略图中仍能读清主标题。不要添加用户没有要求的价格、日期、联系方式、水印、品牌名或额外口号。不要生成画框、手机界面、样机展示或海报外部环境，只输出海报成品本身。",
  ].join("\n\n");
}
