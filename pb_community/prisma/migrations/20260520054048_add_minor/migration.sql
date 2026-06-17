-- AddForeignKey
ALTER TABLE "public"."Reports" ADD CONSTRAINT "Reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reports" ADD CONSTRAINT "Reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "public"."users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reports" ADD CONSTRAINT "Reports_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "public"."rooms"("roomId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reports" ADD CONSTRAINT "Reports_privateId_fkey" FOREIGN KEY ("privateId") REFERENCES "public"."privates"("privateId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reports" ADD CONSTRAINT "Reports_roomPostId_fkey" FOREIGN KEY ("roomPostId") REFERENCES "public"."RoomPost"("postId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reports" ADD CONSTRAINT "Reports_privatePostId_fkey" FOREIGN KEY ("privatePostId") REFERENCES "public"."private_posts"("postId") ON DELETE SET NULL ON UPDATE CASCADE;
