const { Hono } = require('hono');
const { html } = require('hono/html');
const layout = require('../layout');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });
const app = new Hono();


// トップページ
app.get('/', async (c) => {
  const session = c.get('session');
  const sessionUser = session?.user;
  if (!sessionUser) {
    return c.redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { userId: sessionUser.userId },
  })

  const now = new Date();

if (user.isLimited && user.LimitExpiresAt) {
  if (new Date(user.LimitExpiresAt) <= now) {
    await prisma.user.update({
      where: { userId: user.userId },
      data: {
        isLimited: false,
        LimitedReason: null,
        LimitExpiresAt: null,
      },
    });

    user.isLimited = false;
  }
}

  const currentUser = {
    isLimited: user.isLimited,
    LimitedReason: user.LimitedReason,
    LimitExpiresAt: user.LimitExpiresAt,
  }

  return c.html(
  layout(
    c,
    'PBerコミュニティ',
    html`
      <h1>PBerコミュニティ</h1>
      <p>ようこそPBerコミュニティへ!コラボの相談や雑談など、ルールを守って使ってね！</p>
      <div>
        <a href="/account">アカウント管理</a>
      </div>
      <h2>メニュー</h2>
     <div>
      <a href="/notifications" id="notif-link">
      🔔 通知 <span id="notif-count"></span>
      </a> 
       <script>
       async function updateNotifCount() {
        const res = await fetch('/notifications/count');
        const data = await res.json();
        const el = document.getElementById('notif-count');
        el.textContent = data.count > 0 ? '(' + data.count + ')' : '';
       }
      updateNotifCount();
       setInterval(updateNotifCount, 10000); // 10秒ごとに更新
      </script>
      </div>
  
      <br/>

      <div>
       <a href="/news">お知らせ</a>
      </div>

      <br/>

      <div>
        <a href="/users">ユーザー一覧</a>
      </div>
      <div>
        <h3>ルーム・プライベートルーム作成</h3>
        ${currentUser.isLimited
  ? html`
    <p class="limit-message">
      <strong>あなたは現在制限中のため、ルームを作成できません。</strong>
      <br>
       ${currentUser.LimitedReason || '理由不明'}<br>
      ${
        currentUser.LimitExpiresAt && !isNaN(new Date(currentUser.LimitExpiresAt))
          ? `期限: ${new Date(currentUser.LimitExpiresAt).toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo'
          })}`
          : '期限: 無期限'
      }
    </p>
  `
  : html`
    <a href="/rooms/new">ルームを作成</a></br/>
    <a href="/privates/new">プライベートルームを作成</a>
  `
}
      </div>
      <div>
       <h3>ルーム・プライベートルーム一覧</h3>
        <a href="/rooms/lists">ルーム一覧を見る</a><br/>
        <a href="/privates/lists">プライベートルーム一覧を見る</a>
      </div>
    `
  )
);
});

module.exports = app;