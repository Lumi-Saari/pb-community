const { createMiddleware } = require('hono/factory');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function ensureAuthenticated() {
  return createMiddleware(async (c, next) => {
    const session = c.get('session');
    const user = session?.user;

    // セッションなし → ログインページへ
    if (!user) {
      return c.redirect('/login');
    }

    // DBからユーザー確認
    const foundUser = await prisma.user.findUnique({
      where: { userId: user.userId },
      select: { isDeleted: true, isBanned: true } // 必要な項目だけ取得
    });

    // 存在しない or 退会済み（isDeleted = true） or バンされている（isBanned = true）
    if (!foundUser || foundUser.isDeleted || foundUser.isBanned) {
      // セッション情報をクリア
      session.user = null;

      // セッション管理ライブラリを使っている場合は削除処理を追加（例）
      if (c.env.sessions?.deleteSession) {
        await c.env.sessions.deleteSession(c);
      }

      if(foundUser.isBanned){
        return c.redirect('/ban')
      }else{

      return c.redirect('/login');
      }
    }

    // OKなら次の処理へ
    await next();
  });
}

module.exports = ensureAuthenticated;