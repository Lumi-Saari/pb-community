-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "BanExpiresAt" TIMESTAMP(3),
ADD COLUMN     "BanInternalNote" TEXT;
