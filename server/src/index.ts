import { Hono } from "hono";
import { accessRoutes } from "./routes/access";
import { activityRoutes } from "./routes/activity";
import { adminRoutes } from "./routes/admin";
import { aiRoutes } from "./routes/ai";
import { billingRoutes } from "./routes/billing";
import { posterRoutes } from "./routes/posters";
import { settingsRoutes } from "./routes/settings";
import { tutorialRoutes } from "./routes/tutorials";

const app = new Hono()
  .route("/", accessRoutes)
  .route("/", activityRoutes)
  .route("/", adminRoutes)
  .route("/", aiRoutes)
  .route("/", billingRoutes)
  .route("/", posterRoutes)
  .route("/", settingsRoutes)
  .route("/", tutorialRoutes)
  .notFound((c) => c.json({ ok: false, error: { code: "NOT_FOUND", message: "接口不存在" } }, 404))
  .onError((error, c) => {
    console.error("Unhandled application error", { name: error.name, message: error.message });
    return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试" } }, 500);
  });

export default app;
