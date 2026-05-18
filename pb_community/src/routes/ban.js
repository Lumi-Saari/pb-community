const { Hono } = require('hono');
const { html } = require('hono/html');
const layout = require('../layout');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });
const app = new Hono();

app.get('/', async (c) => {
  const { user } = c.get('session');
  if (!user) return c.redirect('/login');

  const dbUser = await prisma.user.findUnique({
    where: { userId: user.userId },
    select: {
      isBanned: true,
      BanReason: true,
      BanExpiresAt: true,
    }
    });

  if (!dbUser?.isBanned) {
    return c.redirect('/');
  }
  
  return c.html(
    layout(
      c,
      'BANされています',
      html`
      <h1>アカウントは停止されました。</h1>
      <h3>あなたのアカウントは利用規約違反により停止されています。</h3>
      <div>
      理由: ${dbUser.BanReason || '不明'}<br/>
      期間: ${dbUser.BanExpiresAt ? new Date(dbUser.BanExpiresAt).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'}) + 'まで': '無期限'}<br/>
      </div>
      `
    )
  )
});

module.exports = app;