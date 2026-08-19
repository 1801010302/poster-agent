import { Hono, type Context } from "hono";
import { vars } from "edgespark";
import { auth } from "edgespark/http";
import { AppError, requireActiveAccess } from "../services/access";
import { getUserProviderKey } from "../services/credentials";
import { createPosterPlan } from "../services/deepseek";

function fail(c: Context, error: unknown) {
  if (error instanceof AppError) return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
  console.error("AI plan error", error instanceof Error ? error.message : "unknown");
  return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "AI 策划暂时不可用" } }, 500);
}

export const aiRoutes = new Hono().post("/api/ai/plan", async (c) => {
  if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
  try {
    await requireActiveAccess(auth.user.id);
    const input = await c.req.json<{ mode?: string; copy?: string }>().catch(() => ({} as { mode?: string; copy?: string }));
    const copy = String(input.copy || "").trim();
    if (!copy) throw new AppError("COPY_REQUIRED", "请先输入朋友圈文案或图片要求", 400);
    if (copy.length > 2000) throw new AppError("COPY_TOO_LONG", "输入内容不能超过 2000 个字符", 400);
    const apiKey = await getUserProviderKey(auth.user.id, "deepseek");
    const apiBase = (vars.get("DEEPSEEK_API_BASE") || "https://api.deepseek.com").replace(/\/+$/u, "");
    const plan = await createPosterPlan(apiKey, apiBase, { mode: input.mode === "prompt" ? "prompt" : "copy", copy });
    return c.json({ ok: true, data: plan });
  } catch (error) { return fail(c, error); }
});
