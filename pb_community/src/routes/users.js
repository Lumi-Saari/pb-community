const { Hono } = require('hono');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });
const ensureAuthenticated = require('../middlewares/ensure-authenticated');
const users = new Hono();

users.use(ensureAuthenticated());

users.get('/', async (c) => {
  const { user } = c.get('session');
  if (!user) return c.redirect('/login');

  const userId = user.userId;

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

  const username = await prisma.user.findUnique({
    where: { userId },
    select: { username: true }
  }).then(u => u?.username || '名無しユーザー');

  // HTML
const userList = allUsers.map(p => `
  <div class="user-card">
    <p>
      <h3>
        <img src="${p.iconUrl || '/uploads/default.jpg'}" alt="アイコン" width="50" height="50">
        <strong>
          ${p.username ?? '名無しユーザー'}
          ${p.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}
        </strong>
      </h3>
    </p>

    <p>活動場所: ${p.activityPlace ?? '未設定'}</p>
    <p>自己紹介: ${p.bio ?? '未設定'}</p>

    <button
      class="report-user-btn js-modal-open"
      data-userid="${p.userId}"
    >
      通報
    </button>

    <div class="modal js-modal">
      <div class="modal-container">

        <button type="button" class="modal-close js-modal-close">
          ×
        </button>

        <div class="modal-content">
          <h2>違反内容はなんですか?</h2>

          <form class="reasonForm">
            <input
              type="hidden"
              name="targetUserId"
              value="${p.userId}"
            >

            <div class="reason-list">
              <label>
                <input type="checkbox" name="reason" value="harassment">
                嫌がらせ
              </label>

              <label>
                <input type="checkbox" name="reason" value="fake">
                なりすまし
              </label>

              <label>
                <input type="checkbox" name="reason" value="spam">
                スパム行為
              </label>

              <label>
                <input
                  type="checkbox"
                  name="reason"
                  value="others"
                  class="otherCheck"
                >
                その他
              </label>
            </div>

            <div class="otherBox" style="display:none;">
              <textarea
                name="otherDetail"
                placeholder="理由を入力してください"
              ></textarea>
            </div>

            <button
              type="button"
              class="reason-btn"
              data-userid="${p.userId}"
            >
              通報する
            </button>
          </form>
        </div>

      </div>
    </div>

    <hr>
  </div>
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

<script>
 document.querySelectorAll('.otherCheck').forEach(checkbox => {
  checkbox.addEventListener('change', () => {
    const otherBox = checkbox.closest('.reason-list').nextElementSibling;
    if (checkbox.checked) {
      otherBox.style.display = 'block';
    } else {
      otherBox.style.display = 'none';
    }
  });
});

//要素を取得
const modal = document.querySelector('.js-modal'),
      open = document.querySelector('.js-modal-open'),
      close = document.querySelector('.js-modal-close');

//「開くボタン」をクリックしてモーダルを開く
function modalOpen() {
  modal.classList.add('is-active');
}
open.addEventListener('click', modalOpen);

//「閉じるボタン」をクリックしてモーダルを閉じる
function modalClose() {
  modal.classList.remove('is-active');
}
close.addEventListener('click', modalClose);

//「モーダルの外側」をクリックしてモーダルを閉じる
function modalOut(e) {
  if (e.target == modal) {
    modal.classList.remove('is-active');
      }
      }
        addEventListener('click', modalOut);

       document.querySelectorAll('.reason-btn').forEach(btn => {
       btn.addEventListener('click', async () => {
       const checkboxes = document.querySelectorAll('input[name="reason"]:checked');
       const arr = Array.from(checkboxes).map(cb => cb.value);
   
          const 嫌がらせ = arr.includes('harassment') ? 'ハラスメント' : '';
          const なりすまし = arr.includes('fake') ? 'なりすまし' : '';
          const スパム行為 = arr.includes('spam') ? 'スパム行為' : '';
          const その他理由 = arr.includes('others') ? document.querySelector('textarea[name="otherDetail"]').value : '';
          
          const user = \`ユーザー:${username}\`;

          const reportData = {
            isReported: user,
            reasons: [嫌がらせ,なりすまし,スパム行為,その他理由].filter(Boolean)
            };
            
            const res = await fetch('/admin/reports/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportData)
           });

           if(res.ok) {
             alert('このユーザーを通報しました。');
          } else {
             alert('このユーザーの通報に失敗しました。もう一度お試しください。');
          }

          document.querySelector('.js-modal-close').click();
          });
        });
        </script>
        
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