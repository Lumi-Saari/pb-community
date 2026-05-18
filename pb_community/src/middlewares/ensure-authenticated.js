const { createMiddleware } = require('hono/factory');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function ensureAuthenticated() {
  return createMiddleware(async (c, next) => {
  const session = c.get('session');
  const user = session?.user;
  if (!user) {
    return c.redirect('/login');
  }

  const existingUser = await prisma.user.findUnique({ where: { userId: user.userId }, select: { userId: true, isBanned: true, BanReason: true, BanExpiresAt: true } });
  if (!existingUser) {
    return c.redirect('/login');
  }
  
  const now = new Date();
  if (existingUser.isBanned && existingUser.BanExpiresAt) {
    if (new Date(existingUser.BanExpiresAt) <= now) {
      await prisma.user.update({
        where: { userId: existingUser.userId },
        data: {
          isBanned: false,
          BanReason: null,
          BanExpiresAt: null,
        },
      });
    } else {
      c.set('user', existingUser);
      return c.redirect('/ban');
    }
  }

  c.set('user', existingUser);
  await next();
}); 
};
module.exports = ensureAuthenticated;