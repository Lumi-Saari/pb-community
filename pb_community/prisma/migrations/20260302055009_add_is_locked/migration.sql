-- AlterTable
ALTER TABLE "public"."privates" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."rooms" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false;
