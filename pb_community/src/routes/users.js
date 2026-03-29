const { Hono } = require('hono');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });
const ensureAuthenticated = require('../middlewares/ensure-authenticated');
const users = new Hono();

users.use(ensureAuthenticated());

users.get('/', async (c) => {
  const { user } = c.get('session');
  if (!user) return c.redirect('/login');

  const sort = c.req.query('sort') || 'created';

  // 必要な情報を全て取得
  const results = await prisma.user.findMany({
    where: { isDeleted: false, isBanned: false },
    select: {
      userId: true,
      username: true,
      activityPlace: true,
      bio: true,
      iconUrl: true,
      createdAt: true,
      isAdmin: true,
    },
  });

  // 並び替え
  if (sort === 'name') {
    const collator = new Intl.Collator('ja', { sensitivity: 'base', numeric: true });
    results.sort((a, b) => collator.compare(a.username ?? '', b.username ?? ''));
  } else if (sort === 'latest') {
    results.sort((a, b) => {
  const diff = new Date(b.createdAt) - new Date(a.createdAt);
  if (diff !== 0) return diff;
  return (a.id || '').localeCompare(b.id || '');
});
  } else if (sort === 'created') {
    results.sort((a, b) => {
  const diff = new Date(a.createdAt) - new Date(b.createdAt);
  if (diff !== 0) return diff;

  // 同じ時刻ならIDで並べる
  return (a.id || '').localeCompare(b.id || '');
});
  }

  // 自分を先頭に（並び替え後に！）
  const myUser = results.find(u => u.userId === user.userId);
 const others = results.filter(u => u.userId !== user.userId);
  const allUsers = myUser ? [myUser, ...others] : others;

  // HTML
  const userList = allUsers.map(p => `
    <p><h3><img src="${p.iconUrl || '/uploads/default.jpg'}" alt="アイコン" width="50" height="50">
    <strong>${p.username ?? '名無しユーザー'} ${p.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</h3></strong></p>
    <p>活動場所: ${p.activityPlace ?? '未設定'}</p>
    <p>自己紹介: ${p.bio ?? '未設定'}</p>
    <hr/>
  `).join('');

  return c.html(`
    <!doctype html>
    <html>
      <head>
        <title>ユーザー一覧</title>
        <link rel="stylesheet" href="/stylesheets/style.css" />
      </head>
      <body>
      <style>
      .admin-badge {
        background: #ffd700;
  color: #000;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 6px;
  margin-left: 6px;
      }
      </style>
        <h1>ユーザー一覧</h1>
        <a href="/">ホームへ戻る</a>
        <div>
          <a href="/users?sort=name">あいうえお順</a> |
          <a href="/users?sort=created">登録順</a> |
          <a href="/users?sort=latest">新しい順</a>
        </div>
        <h3>ユーザー検索</h3>
        <form method="post" action="/users/search">
          <input type="text" name="q" placeholder="ユーザー名で検索する" />
          <button type="submit">検索</button>
        </form>
        <div id="userList">${userList}</div>

      </body>
    </html>
  `);
});

users.get('/search', async (c) => {
  const { user } = c.get('session');
  if (!user) return c.redirect('/login');

  const q = c.req.query('q') || '';

  const results = await prisma.user.findMany({
    where: {
      username: { contains: q, mode: 'insensitive' },
      isDeleted: false,
      isBanned: false,
    },
    select: {
      userId: true,
      username: true,
      activityPlace: true,
      bio: true,
      iconUrl: true,
      createdAt: true,
      isAdmin: true,
    },
  })


  return c.html(`
    <!doctype html>
    <html>
      <head>
        <title>ユーザー検索結果</title>
        <link rel="stylesheet" href="/stylesheets/style.css" />
      </head>
      <body>
      <style>
      .admin-badge {
        background: #ffd700;
        color: #000;
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 6px;
         margin-left: 6px;
      }
      </style>
      <a href="/users">ユーザー一覧へ戻る</a>
        <h1>ユーザー検索結果</h1>
        <div>
          ${results.map(p => `
            <p><h3><img src="${p.iconUrl || '/uploads/default.jpg'}" alt="アイコン" width="50" height="50">
            <strong>${p.username ?? '名無しユーザー'} ${p.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</h3></strong></p>
            <p>活動場所: ${p.activityPlace ?? '未設定'}</p>
            <p>自己紹介: ${p.bio ?? '未設定'}</p>
            <hr/>
          `).join('') || '<p>該当するユーザーが見つかりませんでした。</p>'}
        </div>

      </body>
    </html>
        `)
});

users.post('/search', async (c) => {
  const body = await c.req.parseBody();
  const q = body.q || '';
  return c.redirect(`/users/search?q=${encodeURIComponent(q)}`);
})

module.exports = users;