-- CreateEnum
CREATE TYPE "UnitPreference" AS ENUM ('km', 'mi');

-- CreateEnum
CREATE TYPE "Game" AS ENUM ('ets2', 'ats');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'manager', 'driver');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('pending', 'active', 'inactive', 'left', 'removed');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('delivered', 'cancelled', 'flagged', 'rejected');

-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('km', 'jobs', 'income');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "steamId64" TEXT,
    "truckersmpId" INTEGER,
    "unitPreference" "UnitPreference" NOT NULL DEFAULT 'km',
    "showOnLiveMap" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tag" TEXT,
    "logoUrl" TEXT,
    "truckersmpVtcId" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "discordGuildId" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'driver',
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastVtcCheckAt" TIMESTAMP(3),

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "status" "ApplicationStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rank" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minKm" DOUBLE PRECISION NOT NULL,
    "color" TEXT,
    "discordRoleId" TEXT,

    CONSTRAINT "rank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "companyId" TEXT,
    "deviceId" TEXT,
    "clientJobId" TEXT NOT NULL,
    "game" "Game" NOT NULL,
    "multiplayer" BOOLEAN NOT NULL DEFAULT false,
    "sourceCity" TEXT NOT NULL,
    "sourceCompany" TEXT NOT NULL,
    "destCity" TEXT NOT NULL,
    "destCompany" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "cargoMassKg" DOUBLE PRECISION NOT NULL,
    "plannedKm" DOUBLE PRECISION NOT NULL,
    "drivenKm" DOUBLE PRECISION NOT NULL,
    "odometerStart" DOUBLE PRECISION NOT NULL,
    "odometerEnd" DOUBLE PRECISION NOT NULL,
    "income" INTEGER NOT NULL,
    "damagePct" DOUBLE PRECISION NOT NULL,
    "maxSpeedKmh" DOUBLE PRECISION NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "status" "JobStatus" NOT NULL,
    "flagReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reportedAs" "JobStatus",
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_event" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "job_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metric" "GoalMetric" NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_post" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_status" (
    "companyId" TEXT NOT NULL,
    "guildId" TEXT,
    "guildOk" BOOLEAN NOT NULL DEFAULT false,
    "guildReason" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastProblem" TEXT,
    "lastProblemAt" TIMESTAMP(3),

    CONSTRAINT "bot_status_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "tracker_device" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracker_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracker_pairing" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "appVersion" TEXT,
    "driverId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracker_pairing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "driver_userId_key" ON "driver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_steamId64_key" ON "driver"("steamId64");

-- CreateIndex
CREATE UNIQUE INDEX "driver_truckersmpId_key" ON "driver"("truckersmpId");

-- CreateIndex
CREATE UNIQUE INDEX "company_slug_key" ON "company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "company_truckersmpVtcId_key" ON "company"("truckersmpVtcId");

-- CreateIndex
CREATE INDEX "membership_companyId_status_idx" ON "membership"("companyId", "status");

-- CreateIndex
CREATE INDEX "membership_driverId_status_idx" ON "membership"("driverId", "status");

-- CreateIndex
CREATE INDEX "application_companyId_status_idx" ON "application"("companyId", "status");

-- CreateIndex
CREATE INDEX "rank_companyId_minKm_idx" ON "rank"("companyId", "minKm");

-- CreateIndex
CREATE UNIQUE INDEX "rank_companyId_name_key" ON "rank"("companyId", "name");

-- CreateIndex
CREATE INDEX "job_companyId_finishedAt_idx" ON "job"("companyId", "finishedAt");

-- CreateIndex
CREATE INDEX "job_driverId_finishedAt_idx" ON "job"("driverId", "finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_driverId_clientJobId_key" ON "job"("driverId", "clientJobId");

-- CreateIndex
CREATE INDEX "job_event_jobId_idx" ON "job_event"("jobId");

-- CreateIndex
CREATE INDEX "goal_companyId_endAt_idx" ON "goal"("companyId", "endAt");

-- CreateIndex
CREATE INDEX "outbox_event_processedAt_createdAt_idx" ON "outbox_event"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "bot_post_kind_createdAt_idx" ON "bot_post"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bot_post_companyId_kind_key_key" ON "bot_post"("companyId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "tracker_device_tokenHash_key" ON "tracker_device"("tokenHash");

-- CreateIndex
CREATE INDEX "tracker_device_driverId_idx" ON "tracker_device"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "tracker_pairing_deviceCodeHash_key" ON "tracker_pairing"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "tracker_pairing_userCode_key" ON "tracker_pairing"("userCode");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver" ADD CONSTRAINT "driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rank" ADD CONSTRAINT "rank_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "tracker_device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_post" ADD CONSTRAINT "bot_post_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_status" ADD CONSTRAINT "bot_status_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_device" ADD CONSTRAINT "tracker_device_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_pairing" ADD CONSTRAINT "tracker_pairing_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
