/*
  Warnings:

  - You are about to drop the column `reporterId` on the `Reports` table. All the data in the column will be lost.
  - Added the required column `reporter` to the `Reports` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Reports" DROP COLUMN "reporterId",
ADD COLUMN     "reporter" TEXT NOT NULL;
