import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "edgespark";
import { auth } from "edgespark/http";
import { userDailyActivity } from "@defs";
import { beijingDayKey } from "../services/time";

const ALLOWED_PATHS = new Set(["create", "works", "result", "admin"]);

export const activityRoutes = new Hono()
  .post("/api/activity/heartbeat", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    const body = await c.req.json<{ path?: string }>().catch(() => ({} as { path?: string }));
    const path = ALLOWED_PATHS.has(String(body.path)) ? String(body.path) : "create";
    const now = Date.now();
    const dayKey = beijingDayKey(now);
    const id = `${dayKey}:${auth.user.id}`;
    await db.insert(userDailyActivity).values({
      id,
      dayKey,
      userId: auth.user.id,
      visitCount: 1,
      lastPath: path,
      firstSeenAt: now,
      lastSeenAt: now,
    }).onConflictDoUpdate({
      target: userDailyActivity.id,
      set: {
        visitCount: sql`${userDailyActivity.visitCount} + 1`,
        lastPath: path,
        lastSeenAt: now,
      },
    });
    return c.json({ ok: true, data: { recorded: true, dayKey } });
  })
  .get("/api/activity/last-seen", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    const [row] = await db.select({ lastSeenAt: userDailyActivity.lastSeenAt })
      .from(userDailyActivity)
      .where(eq(userDailyActivity.userId, auth.user.id))
      .orderBy(sql`${userDailyActivity.lastSeenAt} desc`)
      .limit(1);
    return c.json({ ok: true, data: { lastSeenAt: row?.lastSeenAt || null } });
  });
