const { Hono } = require('hono');
const { html } = require('hono/html');
const layout = require('../layout');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });
const app = new Hono();

// トップページ
app.get('/', async (c) => {
  

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
      </div>
      <div>
        <a href="/users">ユーザー一覧</a>
      </div>
      <div>
        <h3>ルーム・プライベートルーム作成</h3>
        <a href="/rooms/new">ルームを作る</a><br/>
        <a href="/privates/new">プライベートルームを作る</a>
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