import { and, eq } from "drizzle-orm";
import { db, vars } from "edgespark";
import { accessGrants, appProfiles } from "@defs";

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function normalizeEmail(value: string | null): string {
  return (value || "").trim().toLowerCase();
}

export async function ensureProfile(user: { id: string; email: string | null; name: string | null }) {
  const now = Date.now();
  const bootstrapEmail = normalizeEmail(vars.get("ADMIN_BOOTSTRAP_EMAIL"));
  const role = bootstrapEmail && normalizeEmail(user.email) === bootstrapEmail ? "admin" : "user";
  await db.insert(appProfiles).values({
    userId: user.id,
    displayName: user.name,
    role,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: appProfiles.userId,
    set: { displayName: user.name, ...(role === "admin" ? { role: "admin" } : {}), updatedAt: now },
  });

  if (role === "admin") {
    await db.insert(accessGrants).values({
      userId: user.id,
      status: "active",
      source: "admin_bootstrap",
      grantedAt: now,
      expiresAt: null,
      revokedAt: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: accessGrants.userId,
      set: { status: "active", source: "admin_bootstrap", expiresAt: null, revokedAt: null, updatedAt: now },
    });
  } else {
    await db.insert(accessGrants).values({
      userId: user.id,
      status: "pending",
      source: null,
      updatedAt: now,
    }).onConflictDoNothing();
  }
}

export async function getAccessState(userId: string) {
  const [row] = await db.select({
    status: accessGrants.status,
    source: accessGrants.source,
    expiresAt: accessGrants.expiresAt,
    role: appProfiles.role,
  }).from(accessGrants)
    .leftJoin(appProfiles, eq(appProfiles.userId, accessGrants.userId))
    .where(eq(accessGrants.userId, userId))
    .limit(1);
  const active = row?.status === "active" && (row.expiresAt === null || row.expiresAt > Date.now());
  return {
    activated: active,
    accessStatus: active ? "active" : row?.status === "active" ? "expired" : row?.status || "pending",
    accessSource: row?.source || null,
    accessExpiresAt: row?.expiresAt || null,
    role: row?.role || "user",
  };
}

export async function requireActiveAccess(userId: string) {
  const state = await getAccessState(userId);
  if (!state.activated) throw new AppError("ACCESS_REQUIRED", "请先使用暗号激活或开通年费会员", 403);
  return state;
}

export async function requireAdmin(userId: string) {
  const [profile] = await db.select({ role: appProfiles.role }).from(appProfiles)
    .where(and(eq(appProfiles.userId, userId), eq(appProfiles.role, "admin")))
    .limit(1);
  if (!profile) throw new AppError("ADMIN_REQUIRED", "仅管理员可以执行此操作", 403);
}
