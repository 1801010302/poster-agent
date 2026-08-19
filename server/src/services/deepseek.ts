import { AppError } from "./access";

export interface PosterPlan {
  posterType: "生活类" | "营销类";
  category: "生活分享" | "观点表达" | "课程推广" | "产品推广";
  visualDirection: string;
  requiredCopy: string[];
  qrPosition: "右下角" | "左下角" | "右侧中部" | "不需要留白";
  reasoningSummary: string;
}

function parseJson(content: string): Record<string, unknown> {
  try { return JSON.parse(content) as Record<string, unknown>; } catch {
    const match = content.match(/\{[\s\S]*\}/u);
    if (!match) throw new AppError("DEEPSEEK_INVALID_JSON", "DeepSeek 返回的策划格式无法识别，请重试", 502);
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function normalizePlan(plan: Record<string, unknown>): PosterPlan {
  const categories = ["生活分享", "观点表达", "课程推广", "产品推广"] as const;
  const qrPositions = ["右下角", "左下角", "右侧中部", "不需要留白"] as const;
  const posterType = plan.posterType === "生活类" ? "生活类" : "营销类";
  const category = categories.includes(plan.category as typeof categories[number])
    ? plan.category as typeof categories[number]
    : posterType === "生活类" ? "生活分享" : "产品推广";
  const qrPosition = qrPositions.includes(plan.qrPosition as typeof qrPositions[number])
    ? plan.qrPosition as typeof qrPositions[number]
    : posterType === "生活类" ? "不需要留白" : "右下角";
  return {
    posterType,
    category,
    visualDirection: String(plan.visualDirection || "真实自然、主体明确、适合朋友圈阅读。").slice(0, 500),
    requiredCopy: Array.isArray(plan.requiredCopy)
      ? plan.requiredCopy.map((item) => String(item).trim().slice(0, 160)).filter(Boolean).slice(0, 4)
      : [],
    qrPosition,
    reasoningSummary: String(plan.reasoningSummary || "已根据内容完成海报策划。").slice(0, 320),
  };
}

export async function createPosterPlan(apiKey: string, apiBase: string, input: { mode?: string; copy?: string }): Promise<PosterPlan> {
  const sourceType = input.mode === "prompt" ? "用户明确描述的图片要求" : "用户准备发布的朋友圈文案";
  const systemPrompt = [
    "你是朋友圈海报智能体的资深创意总监。把用户输入整理成可直接交给生图模型的一次性完整海报方案。",
    "先判断是生活类还是营销类。生活类重视真实场景、情绪和自然感，通常不需要二维码；营销类重视产品或课程卖点、行动主张和信息层级，并预留二维码空白。",
    "绝不虚构价格、日期、数据、联系方式、承诺或品牌背书。海报文字越少越好，只保留最重要且能准确生成的中文。",
    "只输出 JSON，不要 Markdown。字段必须是 posterType、category、visualDirection、requiredCopy、qrPosition、reasoningSummary。",
    "posterType 只能是生活类或营销类；category 只能是生活分享、观点表达、课程推广、产品推广之一；requiredCopy 是 0 到 4 条字符串；qrPosition 只能是右下角、左下角、右侧中部、不需要留白之一。",
  ].join("\n");
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${sourceType}如下：\n${String(input.copy || "").trim()}\n\n请给出克制、明确、可执行的一次性海报方案。` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 1200,
    }),
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  if (!response) throw new AppError("DEEPSEEK_UNAVAILABLE", "DeepSeek 暂时无法连接，请稍后重试", 503);
  const data = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? "DeepSeek API Key 无效，请在服务设置中重新填写"
      : response.status === 402 ? "DeepSeek 账户余额不足，请充值后重试"
        : response.status === 429 ? "DeepSeek 当前请求过多，请稍后重试"
          : data.error?.message || `DeepSeek 策划失败（${response.status}）`;
    throw new AppError(`DEEPSEEK_${response.status}`, message, response.status === 401 ? 400 : 502);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new AppError("DEEPSEEK_EMPTY", "DeepSeek 没有返回策划内容，请重试", 502);
  return normalizePlan(parseJson(content));
}
