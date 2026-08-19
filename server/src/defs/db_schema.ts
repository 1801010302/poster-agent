import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { esSystemAuthUser } from "../__generated__/sys_schema";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const appProfiles = sqliteTable(
  "app_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("user"),
    displayName: text("display_name"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [index("app_profiles_role_idx").on(table.role)],
);

export const accessGrants = sqliteTable(
  "access_grants",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    source: text("source"),
    grantedAt: integer("granted_at"),
    expiresAt: integer("expires_at"),
    revokedAt: integer("revoked_at"),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [index("access_grants_status_expiry_idx").on(table.status, table.expiresAt)],
);

export const inviteCodes = sqliteTable(
  "invite_codes",
  {
    id: text("id").primaryKey(),
    codeDigest: text("code_digest").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull().default("active"),
    maxUses: integer("max_uses").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: integer("expires_at"),
    createdBy: text("created_by").references(() => esSystemAuthUser.id),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("invite_codes_digest_unique").on(table.codeDigest),
    index("invite_codes_status_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const inviteRedemptions = sqliteTable(
  "invite_redemptions",
  {
    id: text("id").primaryKey(),
    inviteCodeId: text("invite_code_id")
      .notNull()
      .references(() => inviteCodes.id),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    redeemedAt: integer("redeemed_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("invite_redemptions_user_unique").on(table.userId),
    index("invite_redemptions_code_idx").on(table.inviteCodeId),
  ],
);

export const providerCredentials = sqliteTable(
  "provider_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    keyPrefix: text("key_prefix").notNull(),
    keyLast4: text("key_last4").notNull(),
    status: text("status").notNull().default("connected"),
    verifiedAt: integer("verified_at").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("provider_credentials_user_provider_unique").on(table.userId, table.provider),
    index("provider_credentials_user_status_idx").on(table.userId, table.status),
  ],
);

export const userDailyActivity = sqliteTable(
  "user_daily_activity",
  {
    id: text("id").primaryKey(),
    dayKey: text("day_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    visitCount: integer("visit_count").notNull().default(1),
    lastPath: text("last_path").notNull().default("create"),
    firstSeenAt: integer("first_seen_at").notNull().default(nowMs),
    lastSeenAt: integer("last_seen_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("user_daily_activity_day_user_unique").on(table.dayKey, table.userId),
    index("user_daily_activity_day_seen_idx").on(table.dayKey, table.lastSeenAt),
    index("user_daily_activity_user_seen_idx").on(table.userId, table.lastSeenAt),
  ],
);

export const posterJobs = sqliteTable(
  "poster_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    providerTaskId: text("provider_task_id"),
    title: text("title").notNull().default("未命名海报"),
    mode: text("mode").notNull().default("copy"),
    posterType: text("poster_type").notNull().default("生活类"),
    category: text("category").notNull().default("生活分享"),
    ratio: text("ratio").notNull().default("3:4"),
    status: text("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(8),
    inputJson: text("input_json").notNull().default("{}"),
    planJson: text("plan_json").notNull().default("{}"),
    outputS3Uri: text("output_s3_uri"),
    remoteImageUrl: text("remote_image_url"),
    errorMessage: text("error_message"),
    errorCode: text("error_code"),
    errorCategory: text("error_category"),
    failureStage: text("failure_stage"),
    retryable: integer("retryable", { mode: "boolean" }).notNull().default(true),
    attemptCount: integer("attempt_count").notNull().default(1),
    lastAttemptAt: integer("last_attempt_at"),
    deadlineAt: integer("deadline_at"),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("poster_jobs_user_idempotency_unique").on(table.userId, table.idempotencyKey),
    index("poster_jobs_user_updated_idx").on(table.userId, table.updatedAt),
    index("poster_jobs_provider_task_idx").on(table.providerTaskId),
  ],
);

export const userReferenceAssets = sqliteTable(
  "user_reference_assets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    path: text("path").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("user_reference_assets_user_role_unique").on(table.userId, table.role),
    index("user_reference_assets_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const onboardingTutorials = sqliteTable(
  "onboarding_tutorials",
  {
    id: text("id").primaryKey(),
    createdBy: text("created_by")
      .notNull()
      .references(() => esSystemAuthUser.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    ossUri: text("oss_uri").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull().default("video/mp4"),
    sizeBytes: integer("size_bytes").notNull(),
    durationSeconds: integer("duration_seconds"),
    status: text("status").notNull().default("uploading"),
    validationError: text("validation_error"),
    publishedAt: integer("published_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("onboarding_tutorials_status_published_idx").on(table.status, table.publishedAt),
    index("onboarding_tutorials_creator_created_idx").on(table.createdBy, table.createdAt),
  ],
);

export const paymentOrders = sqliteTable(
  "payment_orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    merchantOrderNo: text("merchant_order_no").notNull(),
    amountFen: integer("amount_fen").notNull().default(80000),
    currency: text("currency").notNull().default("CNY"),
    status: text("status").notNull().default("pending"),
    paymentProvider: text("payment_provider").notNull().default("wechat_pay"),
    providerTransactionId: text("provider_transaction_id"),
    codeUrl: text("code_url"),
    failureReason: text("failure_reason"),
    paidAt: integer("paid_at"),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("payment_orders_merchant_no_unique").on(table.merchantOrderNo),
    index("payment_orders_user_created_idx").on(table.userId, table.createdAt),
    index("payment_orders_status_idx").on(table.status),
  ],
);

export const paymentTransactions = sqliteTable(
  "payment_transactions",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id"),
    userId: text("user_id"),
    providerTransactionId: text("provider_transaction_id"),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    amountFen: integer("amount_fen").notNull().default(0),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    rawEventJson: text("raw_event_json"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    index("payment_transactions_order_idx").on(table.orderId),
    uniqueIndex("payment_transactions_provider_tx_unique").on(table.providerTransactionId),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => esSystemAuthUser.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    safeMetadataJson: text("safe_metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt)],
);
