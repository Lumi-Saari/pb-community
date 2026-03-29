const { Hono } = require('hono');
const { html } = require('hono/html');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query']});
const ensureAuthenticated = require('../middlewares/ensure-authenticated');

const app = new Hono();

app.use(ensureAuthenticated());

// 通知一覧
app.get('/', async (c) => {
  const { user } = c.get('session') ?? {};
  if (!user?.userId) return c.redirect('/login');
  
  const MAX_NOTIFICATIONS = 50;

  // 全通知（新しい順）を取得
  const notifications = await prisma.notification.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: 'desc' },
  });

  // ★ 古い通知の削除処理
  if (notifications.length > MAX_NOTIFICATIONS) {
    const idsToDelete = notifications
      .slice(MAX_NOTIFICATIONS) // 新しい100件以外を切り出す
      .map(n => n.id);

    await prisma.notification.deleteMany({
      where: { id: { in: idsToDelete } },
    });
  }


return c.html(`
  <h2>通知一覧</h2>
  <div>
    <a href="/">トップページに戻る</a>
  </div>
  <button id="mark-all-read">すべて既読にする</button>
  <ul id="notifications">
    ${notifications.map(n => html`
      <li data-id="${n.id}">
        <a href="${n.url}" class="notif-link">
          ${n.message}
        </a>
        ${n.isRead ? '' : '🆕'}
      </li>
    `).join('')}
  </ul>

  <script>
  const markAllBtn = document.querySelector('#mark-all-read');

  markAllBtn?.addEventListener('click', async () => {
    if (!confirm('すべての通知を既読にしますか？')) return;
    const res = await fetch('/notifications/read-all', { method: 'POST' });
    if (res.ok) {
      document.querySelectorAll('#notifications li').forEach(li => {
        li.innerHTML = li.innerHTML.replace('🆕', '');
      });
      alert('すべて既読にしました');

      // 🟢 ボタンを無効化
      markAllBtn.disabled = true;
      markAllBtn.textContent = 'すべて既読にしました';
    } else {
      alert('既読処理に失敗しました');
    }
  });

  document.querySelectorAll('.notif-link').forEach(link => {
    link.addEventListener('click', async (e) => {
      const li = e.target.closest('li');
      const id = li.dataset.id;
      await fetch('/notifications/' + id + '/read', { method: 'POST' });
    });
  });
</script>

`);

});

// 既読にする
app.post('/:id/read', async (c) => {
  const { user } = c.get('session') ?? {};
  if (!user?.userId) return c.text('ログインしてください', 401);

  const { id } = c.req.param();

  const notif = await prisma.notification.findUnique({
    where: { id: Number(id) },
  });
  if (!notif || notif.userId !== user.userId)
    return c.text('権限がありません', 403);

  await prisma.notification.update({
    where: { id: Number(id) },
    data: { isRead: true },
  });

  return c.json({ ok: true });
});

// 未読数を返す
app.get('/count', async (c) => {
  const { user } = c.get('session') ?? {};
  if (!user?.userId) return c.json({ count: 0 });

  const count = await prisma.notification.count({
    where: { userId: user.userId, isRead: false },
  });

  return c.json({ count });
});

app.post('/read-all', async (c) => {
  const { user } = c.get('session') ?? {};
  if (!user?.userId) return c.text('ログインしてください', 401);

  await prisma.notification.updateMany({
    where: { userId: user.userId, isRead: false },
    data: { isRead: true },
  });

  return c.json({ ok: true });
});



module.exports = app;