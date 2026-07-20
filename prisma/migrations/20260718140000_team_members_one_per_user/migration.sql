-- One identity per email: at most one active team membership per user
CREATE UNIQUE INDEX "team_members_user_one_active_unique"
  ON "team_members" ("userId")
  WHERE "deletedAt" IS NULL;
