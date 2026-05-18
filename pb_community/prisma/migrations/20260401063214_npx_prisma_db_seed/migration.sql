/*
  Warnings:

  - You are about to drop the column `isLocked` on the `rooms` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."rooms" DROP COLUMN "isLocked",
ADD COLUMN     "islocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "isLimited" BOOLEAN NOT NULL DEFAULT false;
