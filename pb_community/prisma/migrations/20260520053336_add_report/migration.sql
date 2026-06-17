-- CreateTable
CREATE TABLE "public"."Reports" (
    "reportId" TEXT NOT NULL,
    "roomId" TEXT,
    "privateId" TEXT,
    "roomPostId" TEXT,
    "privatePostId" TEXT,
    "userId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT,
    "solution" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reports_pkey" PRIMARY KEY ("reportId")
);
