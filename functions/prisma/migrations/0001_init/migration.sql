-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'HN',
    "centroidLat" DOUBLE PRECISION NOT NULL,
    "centroidLon" DOUBLE PRECISION NOT NULL,
    "geometry" JSONB NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "variableId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "parameter" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DOUBLE PRECISION,
    "min" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "median" DOUBLE PRECISION,
    "std" DOUBLE PRECISION,
    "count" INTEGER,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("variableId","source","zoneId","date")
);

-- CreateTable
CREATE TABLE "Trend" (
    "variableId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "firstDate" DATE NOT NULL,
    "lastDate" DATE NOT NULL,
    "n" INTEGER NOT NULL,
    "annual" JSONB NOT NULL,
    "monthly" JSONB NOT NULL,
    "climatology" JSONB NOT NULL,
    "olsSlopePerDecade" DOUBLE PRECISION,
    "senSlopePerDecade" DOUBLE PRECISION,
    "mannKendallZ" DOUBLE PRECISION,
    "mannKendallP" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trend_pkey" PRIMARY KEY ("variableId","source","zoneId")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "variableId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "parameter" TEXT NOT NULL,
    "zoneIds" TEXT[],
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "queryJobId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryJob" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueryJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Observation_zoneId_variableId_date_idx" ON "Observation"("zoneId", "variableId", "date");

-- CreateIndex
CREATE INDEX "IngestionJob_status_idx" ON "IngestionJob"("status");

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

