import { relations } from "drizzle-orm";
import { esSystemAuthUser } from "../__generated__/sys_schema";
import {
  accessGrants,
  appProfiles,
  inviteCodes,
  inviteRedemptions,
  onboardingTutorials,
  paymentOrders,
  posterJobs,
  providerCredentials,
  userDailyActivity,
  userReferenceAssets,
} from "./db_schema";

export const authUserAppRelations = relations(esSystemAuthUser, ({ one, many }) => ({
  profile: one(appProfiles),
  accessGrant: one(accessGrants),
  credentials: many(providerCredentials),
  posterJobs: many(posterJobs),
  paymentOrders: many(paymentOrders),
  dailyActivity: many(userDailyActivity),
  referenceAssets: many(userReferenceAssets),
  onboardingTutorials: many(onboardingTutorials),
}));

export const inviteCodesRelations = relations(inviteCodes, ({ many }) => ({
  redemptions: many(inviteRedemptions),
}));

export const inviteRedemptionsRelations = relations(inviteRedemptions, ({ one }) => ({
  inviteCode: one(inviteCodes, {
    fields: [inviteRedemptions.inviteCodeId],
    references: [inviteCodes.id],
  }),
  user: one(esSystemAuthUser, {
    fields: [inviteRedemptions.userId],
    references: [esSystemAuthUser.id],
  }),
}));
