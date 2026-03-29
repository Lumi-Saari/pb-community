const { Hono } = require('hono');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const setupName = new Hono();

setupName.get('/', (c) => {
  const session = c.get('session');
  const user = session.user;
  if (!user) return c.redirect('/login');

  return c.html(`
    <form method="post" action="/setup-name">
      <label>ユーザー名: <input type="text" name="name" /></label>
      <button type="submit">決定</button>
    </form>
  `);
});

setupName.post('/', async (c) => {
  const body = await c.req.parseBody();
  const session = c.get('session');

  if (!session.user?.userId) {
    return c.redirect('/login');
  }

  const name = body.name; // ← ここで変数を定義

  // 同じ名前が存在するかチェック
  const exists = await prisma.user.findUnique({ where: { username: name } });
  if (exists) {
    return c.text('その名前はすでに使われています', 400);
  }

  // セッション更新
  session.user.name = name;
  await session.save();

  // DB 更新
  await prisma.user.update({
    where: { userId: session.user.userId },
    data: { username: name },
  });

  return c.redirect('/');
});


module.exports = setupName;