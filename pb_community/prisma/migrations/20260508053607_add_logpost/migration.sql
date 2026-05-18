-- CreateTable
CREATE TABLE "public"."LogPost" (
    "postId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogPost_pkey" PRIMARY KEY ("postId")
);
