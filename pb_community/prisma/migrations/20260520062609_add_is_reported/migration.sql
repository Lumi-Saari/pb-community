/*
  Warnings:

  - You are about to drop the column `privateId` on the `Reports` table. All the data in the column will be lost.
  - You are about to drop the column `privatePostId` on the `Reports` table. All the data in the column will be lost.
  - You are about to drop the column `roomId` on the `Reports` table. All the data in the column will be lost.
  - You are about to drop the column `roomPostId` on the `Reports` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Reports` table. All the data in the column will be lost.
  - Added the required column `isReported` to the `Reports` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."Reports" DROP CONSTRAINT "Reports_privateId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Reports" DROP CONSTRAINT "Reports_privatePostId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Reports" DROP CONSTRAINT "Reports_reporterId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Reports" DROP CONSTRAINT "Reports_roomId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Reports" DROP CONSTRAINT "Reports_roomPostId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Reports" DROP CONSTRAINT "Reports_userId_fkey";

-- AlterTable
ALTER TABLE "public"."Reports" DROP COLUMN "privateId",
DROP COLUMN "privatePostId",
DROP COLUMN "roomId",
DROP COLUMN "roomPostId",
DROP COLUMN "userId",
ADD COLUMN     "isReported" TEXT NOT NULL;
