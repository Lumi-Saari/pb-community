-- AlterTable
ALTER TABLE "public"."RoomPost" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."private_posts" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false;
