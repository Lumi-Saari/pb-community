const { createMiddleware } = require('hono/factory');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();


function requireAdmin() {
  return createMiddleware(async (c, next) => {
    const { user } = c.get('session');
    if (!user) return c.redirect('/login');

    if (!user.isAdmin) {
      return c.html(
        `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p><a href="/">トップページへ戻る</a>`,
        403
      )
    }

    await next();
  });
}

module.exports = requireAdmin;