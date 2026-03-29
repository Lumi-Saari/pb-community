const { Hono } = require('hono');
const { html } = require('hono/html');
const layout = require('../layout');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });
const app = new Hono();

app.get('/' , async (c) => {
  const { user } = c.get('session');
  if(!user) return c.redirect('/login');

  if(!user.isBanned) return c.redirect('/');

    await prisma.user.findUnique({
      where: { userId: user.userId },
      select: {
        BanReason: true,
        BanExpiresAt: true,
      }
    }).then(banInfo => {
      user.BanReason = banInfo.BanReason;
      user.BanExpiresAt = banInfo.BanExpiresAt;
    });
  
  return c.html(
    layout(
      c,
      'BANされています',
      html`
      <h1>アカウントは停止されました。</h1>
      <h3>あなたのアカウントは利用規約違反により停止されています。</h3>
      <div>
      理由: ${user.BanReason || '不明'}<br/>
      期間: ${user.BanExpiresAt ? new Date(user.BanExpiresAt).toLocaleString() + 'まで' : '無期限'}<br/>
      </div>
      `
    )
  )
});

module.exports = app;