const { Hono } = require('hono')
const { html } = require('hono/html');
const layout = require('../layout');
const ensureAuthenticated = require('../middlewares/ensure-authenticated');
const requireAdmin = require('../middlewares/requireAdmin');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });

const app = new Hono();

app.use(ensureAuthenticated());


function roomTable(rooms) {
  return html`
    <table>
      <tbody>
        ${rooms.map(
          (room) => html`
            <tr>
              <td>
                ・<a href="/rooms/${room.roomId}">${room.roomName}</a>
              </td>
            </tr>
          `
        )}
      </tbody>
    </table>
  `;
}

async function checkLimit(user) {
  const now = new Date();

  if (!user.isLimited) return false;

  if (user.LimitExpiresAt && new Date(user.LimitExpiresAt) <= now) {
    await prisma.user.update({
      where: { userId: user.userId },
      data: {
        isLimited: false,
        LimitedReason: null,
        LimitExpiresAt: null,
      },
    });

    user.isLimited = false;
    user.LimitedReason = null;
    user.LimitExpiresAt = null;
    return false;
  }
  return true;
}

app.get('/new', async (c) => {
  const session = c.get('session');
  const sessionUser = session?.user

  const user = await prisma.user.findUnique({
    where: { userId: sessionUser.userId }
  });

  const isLimitedNow = await checkLimit(user);

    const currentUser = {
    isLimited: user.isLimited,
    LimitedReason: user.LimitedReason,
    LimitExpiresAt: user.LimitExpiresAt
  }

  if (isLimitedNow) {
  return c.html(`
    <h2>ルームを作成できません</h2>
    <p>現在あなたのアカウントには制限がかかっています。</p>
    <p>${currentUser.LimitedReason || '理由不明'}</p>
    <p>
      ${
        currentUser.LimitExpiresAt
          ? `期限: ${new Date(currentUser.LimitExpiresAt).toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo'
          })}`
          : '期限: 無期限'
      }
    </p>
    <a href="/">戻る</a>
  `, 403);
}
  return c.html(
  layout(
    c,
    'ルームの作成',
    html`
      <form method="post" action="/rooms">
        <div>
         <h1>ルームを作成する</h1>
          <h5>ルーム名 二十五文字まで</h5>
          <input type="text" name="roomName" maxlength="25" />
        </div>
        <div>
          <h5>説明（なくてもOK）五十文字まで</h5>
          <textarea name="memo" rows="5" cols="40" maxlength="50"></textarea>
        </div>
        <button type="submit">ルームを作成</button>
      </form>
    `,
   ),
  );
});

// ルーム作成
app.post('/', async (c) => {
  const session = c.get('session');
  const sessionUser = session?.user

  const user = await prisma.user.findUnique({
    where: { userId: sessionUser.userId }
  });
  const body = await c.req.parseBody();

  if (!user?.userId) return c.json({ error: 'ログインしてください' }, 401);

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

  if (!user || user.isDeleted) {
    return c.html(layout(c, 'エラー', html`
      <p>ログイン情報がありません。再度ログインしてください。</p>
      <a href="/login">ログイン</a>
    `));
  }

  const currentUser = {
    isLimited: user.isLimited
  }

  if(currentUser.isLimited) return c.text('あなたは制限されているためルームを作成できません', 403);

 const room = await prisma.room.create({
  data: {
    roomId: randomUUID(),
    roomName: body.roomName || "名称未設定",
    memo: body.memo || "",
    createBy: user.userId,  // ← 外部キーのフィールドを直接指定！
  },
  select: { roomId: true, roomName: true, updatedAt: true }
});

  return c.redirect('/rooms/' + room.roomId);
});

app.post('/:roomId/delete', async (c) => {
  const { user } = c.get('session') ?? {};
  const { roomId } = c.req.param();

  if (!user?.userId) return c.text('ログインしてください', 401);

  const room = await prisma.room.findUnique({ where: { roomId} });
  if (!room) return c.text('ルームが見つかりません', 404);
  
  const isAdmin = user.isAdmin;

  // 作成者チェックを追加
  if (room.createBy !== user.userId && !isAdmin) {
    return c.text('作成者または管理者のみがルームを削除できます', 403);
  }

  await prisma.roomPost.deleteMany({ where: { roomId } });

  await prisma.room.delete({ where: { roomId } });

  return c.redirect('/');
});

//　TODO 説明を更新する機能
app.post('/roomId/memo', async (c) => {
  const { user } = c.get('session') ?? {};
  const { roomId } = c.req.param();
  const body = await c.req.parseBody();

  if (!user?.userId) return c.text('ログインしてください', 401);

  const room = await prisma.room.findUnique({ where: { roomId} });
  if (!room) return c.text('ルームが見つかりません', 404);

  // 作成者チェックを追加
  if (room.createBy !== user.userId) {
    return c.text('このルームの作成者のみが説明を変更できます', 403);
  }

  await prisma.memo.upsert({
    where: { roomId },
    update: { memo: body.memo || "" },
    create: { roomId, memo: body.memo || "" },
  })
})

app.get('/lists', async (c) => {
  const { user } = c.get('session') ?? {};

  if (!user) {
    return c.redirect('/login');
  }

  const rooms = await prisma.room.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { roomId: true, roomName: true, updatedAt: true },
  });

  return c.html(
    layout(
      c,
       'ルーム一覧',
      html`
        <a href="/">トップページへ戻る</a>
        <h2>ルーム一覧</h2>
          <p>誰でも見られるルームです。</p>
        <h3>検索</h3>
        <form method="get" action="/rooms/lists/search">
          <input type="text" name="q" placeholder="ルーム名で検索"/>
          <button type="submit">検索</button>
        </form>
        <hr/>
        ${rooms.length > 0
          ? roomTable(rooms)
          : html`<p>まだルームはありません</p>`}
      `
    )
  );
});

app.get('/lists/search', async (c) => {
  const { user } = c.get('session') ?? {};
  const q = c.req.query('q') || '';

  if (!user) {
    return c.redirect('/login');
  }

  const rooms = await prisma.room.findMany({
    where: {
      roomName: {
        contains: q,
      },
    },
    orderBy: { updatedAt: 'desc' },
    select: { roomId: true, roomName: true, updatedAt: true },
  });

  return c.html(
    layout(
      c,
      'ルーム検索結果',
      html`
       <a href="/rooms/lists">ルーム一覧に戻る</a>
       <h2>ルーム検索結果: 「${q}」</h2>
        ${rooms.length > 0
          ? roomTable(rooms)
          : html`<p>該当するルームはありません</p>`}
      `
    )
  );
});

app.post('/lists/search', async (c) => {
  const body = await c.req.parseBody();
  const q = body.q || '';
  return c.redirect(`/rooms/lists/search?q=${encodeURIComponent(q)}`);
});

app.get('/:roomId/posts/search', async (c) => {
  const { roomId } = c.req.param();
  const q = c.req.query('q') || '';

  const posts = await prisma.RoomPost.findMany({
    where: {
      roomId,
      content: { contains: q, mode: 'insensitive'},
      isDeleted: false,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      content: true, postId: true, createdAt: true, imageUrl: true, thumbnailUrl: true, isDeleted: true, user: { select: { username: true, iconUrl: true }},
    }
  });

  app.post('/:roomId/posts/search', async (c) => {
  const { roomId } = c.req.param();  
  const body = await c.req.parseBody();
  const q = body.q || '';
  return c.redirect(`/rooms/${roomId}/posts/search?q=${encodeURIComponent(q)}`);
});

  return c.html(`
    <!doctype html>
    <html>
     <head>
      <title>投稿検索結果</title>
      <link rel="stylesheet" href="/stylesheets/style.css" />
      </head>
      <body>
      <a href="/rooms/${roomId}">ルームへ戻る</a>
        <h1>投稿検索結果</h1>
        <div>
         ${posts.length > 0 ?
          posts.map(p => `
            <p>
            <strong>${p.user.username}</strong><br/>
            <img src="${p.user.iconUrl || '/uploads/default.jpg'}" width="40">${p.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}
            ${p.content || '' }<br/>
            ${p.thumbnailUrl ? `<img src="${p.thumbnailUrl}" width="200" class="zoomable" data-full="${p.imageUrl}">` : '' }
            <small>${new Date(p.createdAt).toLocaleDateString()}</small>
            </p>
            <hr/>
            `).join('') : '<p>検索結果が見つかりませんでした。</p>'}
            </div>
      </body>
    </html>
         `)
});

app.get('/:roomId', async (c) => {
  const { roomId } = c.req.param();
  const memo = await prisma.room.findUnique({
    where: { roomId },
    select: { memo: true }
  }).then(r => r?.memo);

  const room = await prisma.room.findUnique({
  where: { roomId },
  select: {
    roomName: true,
    islocked: true,
    user: {
      select: {
        username: true,
      }
    }
  }
});

  if (!room) return c.text('ルームが存在しません', 404);

const posts = await prisma.RoomPost.findMany({
  where: {
    roomId,
    parentId: null, 
    isDeleted: false,
  },
  orderBy: { createdAt: 'asc' },
  select: {
    postId: true,
    content: true,
    createdAt: true,
    imageUrl: true,
    thumbnailUrl: true,
    isDeleted: true,
    isLocked: true,
    user: {
      select: { username: true, iconUrl: true, isAdmin: true },
    },
    replies: {
      where: { isDeleted: false },
      orderBy: { createdAt: 'asc' },
      select: {
        postId: true,
        parentId: true,
        content: true,
        createdAt: true,
        isDeleted: true,
        user: {
          select: { username: true, iconUrl: true, isAdmin: true},
        },
      },
    },
  },
});



// 親投稿だけ
const parents = posts.filter(p => p.parentId === null);

const tree = parents.map(parent => ({
  ...parent,
  replies: posts.filter(p => p.parentId === parent.postId),
  replyCount: posts.filter(p => p.parentId === parent.postId).length
}));

const session = c.get('session');
const sessionUser = session?.user;

const user = await prisma.user.findUnique({
  where: { userId: sessionUser.userId }
});

const currentUser = {
  userId: user.userId,
  isAdmin: user.isAdmin,
  isLimited: user.isLimited,
  LimitedReason: user.LimitedReason,
  LimitExpiresAt: user.LimitExpiresAt,
};

const roomisLocked = room.islocked && !currentUser.isAdmin;
const isLocked = posts.islocked && !currentUser.isAdmin;
const lockMessageHTML = currentUser.isAdmin
 ? `
   <button class="posts-lock-btn" data-postid="${posts.postId}">
    ロック
   </button>
 `
 : '';

const isLimited = currentUser.isLimited;

// UserRoomSetting テーブルに notify TRUE/FALSE の設定があるか探す
const setting = await prisma.userRoomSetting.findFirst({
  where: {
    roomId,
    userId: user.userId,
  },
});

// 判定用フラグ
const notifyEnabled = !!(setting && setting.notify);

const postList = tree.map((p) => `
<style>
hr.end {
  border: none;
  border-top: 1px solid black;
}
  .admin-badge {
  background: #ffd700;
  color: #000;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 6px;
  margin-left: 6px;
}

</style>

  <div class="post" data-postid="${p.postId}">
    <p>
      <strong>${p.user.username} ${p.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</strong><br/>
      <img src="${p.user.iconUrl || '/uploads/default.jpg'}" width="40">${lockMessageHTML}<br/>
      ${p.content || ''}<br/>
      ${p.thumbnailUrl ? `<img src="${p.thumbnailUrl}" width="200" class="zoomable" data-full="${p.imageUrl}">` : ''}
      <small>${new Date(p.createdAt).toLocaleString()}</small>
    </p>


    <!-- 返信一覧（最初は非表示） -->
    <div class="replies" data-parent="${p.postId}" style="display:none;">
      ${
        p.replies.map(r => `
          <div class="reply">
             <hr/>
            <p>
              <strong>${r.user.username}${r.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</strong><br/>
              <img src="${r.user.iconUrl || '/uploads/default.jpg'}" width="40">
              ${r.content}<br/>
              ${r.thumbnailUrl ? `<img src="${r.thumbnailUrl}" width="200" class="zoomable" data-full="${r.imageUrl}">` : ''}
              <small>${new Date(r.createdAt).toLocaleString()}</small>
            </p>
          </div>
        `).join('')
      }
    </div>

        <!-- 返信するボタン -->
    <button class="reply-btn" data-parent="${p.postId}">返信</button>
    
        <!-- 返信フォーム -->
    <form class="reply-form" data-parent="${p.postId}" style="display:none;">
  ${!isLocked ? ` 
      <textarea name="content" rows="2" placeholder="返信を書く"></textarea>
      <input type="file" name="icon" accept="image/*">
      <button type="submit">送信</button>
      ` : `
     `}
    </form>

    ${isLocked ? `<div class="lock-message">この投稿はロック中です。返信できません。</div>` : ''}

    <!-- 返信一覧開閉ボタン（返信がある場合のみ） -->
<div id="reply-count-btn" data-count="${p.replyCount}">
  ${p.replyCount > 0 ? `
      <button class="toggle-replies-btn" data-parent="${p.postId}">
        ▼ ${p.replyCount}件の返信
      </button>
    ` : ''}
</div>

   <hr class="end"/>
  </div>
`).join('');

return c.html(`

<head>
  <title>${room.roomName}</title>
  <style>
hr.end {
  border: none;
  border-top: 1px solid black;
}
  .admin-badge {
  background: #ffd700;
  color: #000;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 6px;
  margin-left: 6px;
}

.modal{
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  text-align: center;
  background: rgba(0,0,0,50%);
  padding: 40px 20px;
  overflow: auto;
  opacity: 0;
  visibility: hidden;
  transition: .3s;
  box-sizing: border-box;
}

.modal:before{
  content: "";
  display: inline-block;
  vertical-align: middle;
  height: 100%;
  margin-left: -0.2em;
}

.modal.is-active{
  opacity: 1;
  visibility: visible;
}

.modal-container{
  position: relative;
  display: inline-block;
  vertical-align: middle;
  max-width: 600px;
  width: 90%;
}

.modal-close{
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  top: -20px;
  right: -20px;
  width: 40px;
  height: 40px;
  color: #fff;
  background: #000;
  border-radius: 50%;
  cursor: pointer;
}

.modal-content{
  background: #fff;
  text-align: left;
  line-height: 1.8;
  padding: 20px;
}

.modal-content p{
  margin: 1em 0;
}

</style>
</head>

  <h1>${room.roomName}</h1>
  <a href="/rooms/lists">ルーム一覧に戻る</a>
  <h4>説明: ${memo || 'なし'}</h4>
  <h4>作成者: ${room.user.username}${room.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</h4>
  <button id="notify-btn-room"
   data-room-id="${roomId}"
   data-notify="${notifyEnabled ? 'true' : 'false'}">
    ${notifyEnabled ? '🔔 通知オン' : '🔕 通知オフ'}
  </button>
  <script src="/notify.js"></script>

  <form action="/rooms/${roomId}/memo" method="post">
    <textarea name="memo" rows="5" cols="40" maxlength="50" placeholder="ここに新しい説明"></textarea>
    <button type="submit">更新</button>
  </form>

  <form method="GET" action="/rooms/${roomId}/posts/search">
  <input type="text" name="q" placeholder="投稿を検索">
  <button type="submit">検索</button>
  </form>

  <form method="POST" action="/rooms/${roomId}/delete" onsubmit="return confirm('本当にこのルームを削除しますか？')">
    <button type="submit">このルームを削除する</button>
  </form>

  <button class="report-room-btn js-room-modal-open">このルームを通報する</button>

  <div class="modal js-room-modal">
    <div class="modal-container">

    <button type="button" class="modal-close js-room-modal-close">
     ×
    </button>

    <div class="modal-content">
      <h2>違反内容はなんですか</h2>
    <form name="resonForm">
     <div class="reasonForm">
      <label>
        <input type="checkbox" name="reason" value="spam">
         スパムコミュニティ
      </label>

      <label>
        <input type="checkbox" name="reason" value="vandalism">
         荒らし目的
      </label>

      <label>
        <input type="checkbox" name="reason" value="danger">
         危険な内容
      </label>

      <label>
        <input type="checkbox" name="reason" value="bad">
         不適切なルーム名・説明
      </label>

      <label>
       <input
         type="checkbox"
         name="reason"
         value="others"
         id="roomotherCheck"
      >
       その他
      </label>

    </div>

    <div id="roomotherBox" style="display: none;">
      <textarea
         name="roomotherDetail"
         placeholder="理由を入力してください"
     ></textarea>
   </div>
  </form>

   <div>
    <button id="checkBtn" class="room-reason-btn">通報する</button>
   </div>

  </div>
 </div>
</div>

<div id="postList">
  ${
    posts.length === 0
      ? '<p>投稿はまだありません</p>'
      : postList
  }
</div>

<div>
${roomisLocked || isLimited ? `
  <p class="lock-message">
  ${
    roomisLocked
      ? 'このルームはロック中です。新しい投稿や返信はできません。'
      : `あなたは投稿できません。${currentUser.LimitedReason}期限: ${
          currentUser.LimitExpiresAt
            ? new Date(currentUser.LimitExpiresAt).toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo'
              }) + 'まで'
            : '無期限'
        }`
  }
  </p>
` : `
  <form id="postForm">
    <textarea name="content"></textarea>
    <input type="file" name="icon" accept="image/*">
    <button type="submit">投稿</button>
  </form>
`}
</div>

<script id="current-user" type="application/json">
      ${JSON.stringify({
        userId: user.userId,
        isAdmin: user.isAdmin,
        isLimited: user.isLimited,
        LimitedReason: user.LimitedReason,
        LimitExpiresAt: user.LimitExpiresAt,
      })}
    </script>

 <script>
  const loading = document.getElementById('loading');
   const roomId = "${roomId}";
    const form = document.getElementById('postForm');
    const postListContainer = document.getElementById('postList');
    const post = ${JSON.stringify(posts)};

  
    let pollingTimer = null;
 function startPolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(fetchPosts, 5000);

}
function stopPolling() {
  if (!pollingTimer) return;
  clearInterval(pollingTimer);
  pollingTimer = null;
}

function generatePostHTML(post) {
  const replyCount = post.replies?.length || 0;

  const currentUser = JSON.parse(
  document.getElementById("current-user").textContent
);

  const isLocked = post.isLocked && !currentUser.isAdmin;
  const isLimited = currentUser.isLimited;

const lockMessageHTML = !isLocked && currentUser.isAdmin ? \`
   <button class="posts-lock-btn" data-postid="\${post.postId}">
    ロック
   </button>
 \`
  : '';

    const unlockButtonHTML = currentUser.isAdmin ? \`
  <button class="posts-unlock-btn" data-postid="\${post.postId}">
    ロック解除
  </button>
  \`
   : '';

  const deleteButtonHTML = currentUser.isAdmin ? \`
    <button class="delete-post-btn" data-postid="\${post.postId}">
      削除
      </button>\` : "";

  const reportButtonHTML = !isLocked && !isLimited ? \`
  <button type="button" class="report-post-btn js-post-modal-open" data-postid="\${post.postId}">
  通報
 </button>

   <div class="modal js-post-modal">
    <div class="modal-container">

    <button type="button" class="modal-close js-post-modal-close">
     ×
    </button>


  <div class="modal-content">
    <h2>違反内容はなんですか?</h2>

    <form class="reasonForm">
     <input type="hidden" name="targetUserId" value="\${post.postId}">

     <div class="reason-list">
       <label>
        <input type="checkbox" name="reason" value="spam">
         スパム・宣伝行為
       </label>

       <label>
        <input type="checkbox" name="reason" value="defamation">
         誹謗中傷・暴言
       </label>

       <label>
        <input type="checkbox" name="reason" value="bad">
         不適切な内容・画像
       </label>

       <label>
        <input type="checkbox" name="reason" value="infomation">
         個人情報の投稿
       </label>

       <label>
        <input type="checkbox" name="reason" value="copyright">
         著作権の侵害
       </label>

       <label>
        <input type="checkbox" name="reason" value="danger">
         危険行為の助長
       </label>

       <label>
        <input
          type="checkbox"
          name="reason"
          value="others"
          class="postotherCheck"
        >
         その他
       </label>
      </div>

      <div class="postotherBox" style="display: none;">
       <textarea
         name="postotherDetail"
         placeholder="理由を入力してください"
        ></textarea>
      </div>

      <button
        type="button"
        class="post-reason-btn"
        data-postid="\${post.postId}"
      >
       通報する
      </button>
    </form>
   </div>

  </div>
</div>
\`
    : '';

  return \`
    <div class="post" data-postid="\${post.postId}">
        <strong>\${post.user.username}\${post.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</strong><br/>
        <img src="\${post.user.iconUrl || '/uploads/default.jpg'}" width="40">\${deleteButtonHTML}
        \${lockMessageHTML}
        \${unlockButtonHTML}
        \${reportButtonHTML}<br/>
        <div class="post-content">\${post.content || ''}</div>
        \${post.thumbnailUrl
          ? \`<img src="\${post.thumbnailUrl}" width="200" class="zoomable" data-full="\${post.imageUrl}">\`
          : ''}
        <small>\${new Date(post.createdAt).toLocaleString()}</small>

          \${
       isLocked || isLimited
    ? \`<div class="lock-message">
        \${
          isLocked
            ? 'この投稿はロック中です。返信できません。'
            : \`あなたは返信できません。\${currentUser.LimitedReason}期限: \${currentUser.LimitExpiresAt ? new Date(currentUser.LimitExpiresAt).toLocaleString('ja-JP') + 'まで' : '無期限'}\`
        }
      </div>\`
        : \`<button class="reply-btn" data-parent="\${String(post.postId)}">返信</button>\`
      }

      \${replyCount > 0 ? \`
        <button class="toggle-replies-btn" data-parent="\${String(post.postId)}">
         ▼\${replyCount}件の返信
         </button>
         \` : ''}

      \${!isLocked && !isLimited ? \`
  <form class="reply-form" data-parent="\${String(post.postId)}" style="display:none;">
    <textarea name="content" rows="2"></textarea>
    <input type="file" name="icon">
    <button type="submit">送信</button>
  </form>
     \` : ''}

              <div class="replies"
       data-parent="\${post.postId}"
       style="display:none">
      </div>
       <hr class="end"/>
       </div>
  \`;
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('postForm');

  if (!form) return;

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // 投稿の内容を把握
  const content = form.querySelector('textarea[name="content"]').value;
  const fileInput = form.querySelector('input[name="icon"]');

//ファイルが選択されている場合はアップロードする
  let imageUrl = null;
  let thumbnailUrl = null;

  if (fileInput.files.length > 0) {
    const formData = new FormData();
    formData.append('icon', fileInput.files[0]);
    const res = await fetch('/rooms/uploads', { method: 'POST', body: formData });
    const data = await res.json();
    imageUrl = data.url;
    thumbnailUrl = data.thumbnail;
  }
// データを送る
  await fetch(\`/rooms/${roomId}/posts\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, imageUrl, thumbnailUrl }),
  });


  await fetchPosts();

  form.reset();
});

});


let deleting = false;

document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("delete-post-btn")) return;

  if (deleting) return;
  deleting = true;



  e.preventDefault();
  e.stopPropagation();

  if (!confirm("削除しますか？")) {
    deleting = false;
    return;
  }

  try {
  const postId = e.target.dataset.postid;

    const post = {
      postId: postId,
    };
    if (!post.postId) {
      alert("投稿IDが見つかりません");
      deleting = false;
      return;
    }

    const res = await fetch(\`/rooms/${roomId}/posts/\${postId}\`, {
      method: "DELETE",
    });

    
    if (!res.ok) {
      alert("削除に失敗しました");
      deleting = false;
      return;
    }

    document
      .querySelector(\`.post[data-postid="\${postId}"]\`)
      ?.remove();

  } finally {
    deleting = false;
  }
});

const postotherCheck = document.getElementById('postotherCheck');
const postotherBox = document.getElementById('postotherBox');

document.addEventListener('change', (e) => {
  if (!e.target.classList.contains('postotherCheck')) return;

  const post = e.target.closest('.post');
  const otherBox = post.querySelector('.postotherBox');

  otherBox.style.display =
    e.target.checked ? 'block' : 'none';
});

document.addEventListener('click', (e) => {
  const openBtn = e.target.closest('.js-post-modal-open');

  if (!openBtn) return;

   const post = openBtn.closest('.post');
  const modal = post.querySelector('.js-post-modal');
  if (modal?.classList.contains('js-post-modal')) {
    modal.classList.add('is-active');
  }
});

document.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('.js-post-modal-close');

  if (!closeBtn) return;

  const modal = closeBtn.closest('.js-post-modal');

  if (modal) {
    modal.classList.remove('is-active');
  }
});

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('js-post-modal-close')) {
    const modal = e.target.closest('.js-post-modal');
    
    if (modal) {
      modal.classList.remove('is-active');
    } 
  }
});
  
document.addEventListener('click', async (e) => {
  if (!e.target.classList.contains('post-reason-btn')) return;

   const post = e.target.closest('.post'); 

    const checkboxes = document.querySelectorAll('input[name="reason"]:checked');
    const arr = Array.from(checkboxes).map(cb => cb.value);
    
    const スパム宣伝行為 = arr.includes('spam') ? 'スパム宣伝行為' : '';
    const 誹謗中傷や暴言 = arr.includes('defamation') ? '誹謗中傷・暴言' : '';
    const 不適切な内容や画像 = arr.includes('bad') ? '不適切な内容・画像' : '';
    const 個人情報の投稿 = arr.includes('infomation') ? '個人情報の投稿' : '';
    const 著作権の侵害 = arr.includes('copyright') ? '著作権の侵害' : '';
    const 危険行為の助長 = arr.includes('danger') ? '危険行為の助長' : '';
    const その他理由 = arr.includes('others') ? document.querySelector('textarea[name="postotherDetail"]').value : '';

    const username = post.querySelector('strong').textContent;

    const content = post.querySelector('.post-content').textContent;
    const isReported = \`ルーム：${room.roomName}の\${username}さんの返信:"\${content}"\`;

    const reportData = {
       isReported: isReported,
       reasons: [スパム宣伝行為, 誹謗中傷や暴言, 不適切な内容や画像, 個人情報の投稿, 著作権の侵害, 危険行為の助長, その他理由].filter(Boolean)
    };
    
    const res = await fetch(\`/admin/reports/posts\`, {
      method: 'POST',
      headers: { 'Content-Type' : 'application/json' },
      body: JSON.stringify(reportData)
    });

    if(res.ok) {
       alert('この投稿を通報しました');
    } else {
       alert('この投稿の通報に失敗しました。もう一度お試しください。');
    }

    if (res.ok) {
      const modal = post.querySelector('.js-post-modal');
       if (modal) {
         modal.classList.remove('is-active');
       }
    }
  });

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.posts-lock-btn');
  if (!btn) return;

  const postId = btn.dataset.postid;

  const confirmed = confirm('このポストの返信をロックしますか?');
  if (!confirmed) return;

  const res = await fetch(\`/rooms/\${roomId}/posts/\${postId}/lock\`, {
    method: 'POST'
  });

  if(res.ok) {
         alert('返信をロックしました。');
         location.reload();
       } else {
         alert('返信のロックに失敗しました。');
        }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.posts-unlock-btn');
  if(!btn) return;

    const postId = btn.dataset.postid;
    
    const confirmed = confirm('このポストの返信のロックを解除しますか?');
    if (!confirmed) return;
    
    const res = await fetch(\`/rooms/\${roomId}/posts/\${postId}/unlock\`, {
       method:'POST'
       });

       if(res.ok) {
         alert('返信のロックを解除しました。');
         location.reload();
       } else {
         alert('返信のロック解除に失敗しました。');
       }
  });

function renderAllPosts(posts) {
  const container = document.getElementById('postList');

  const serverPostIds = new Set(posts.map(p => String(p.postId)));

  container.querySelectorAll('.post').forEach(el => {
    const id = el.dataset.postid;
    if (!serverPostIds.has(id)) {
      el.remove();
    }
  });

  posts.forEach(post => {
    if (post.parentId) return;

    let postEl = container.querySelector(
      \`.post[data-postid="\${post.postId}"]\`
    );

    if (!postEl) {
      container.insertAdjacentHTML('beforeend', generatePostHTML(post));
      postEl = container.querySelector(
        \`.post[data-postid="\${post.postId}"]\`
      );
    }

    const repliesBox = postEl.querySelector(
      \`.replies[data-parent="\${String(post.postId)}"]\`
      );

    if (!repliesBox) return;
    let toggleBtn = postEl.querySelector(
      \`.toggle-replies-btn[data-parent="\${post.postId}"]\`
    );

if (!toggleBtn && post.replies.length > 0) {
  postEl.querySelector('.reply-btn').insertAdjacentHTML(
    'afterend',
    \`
    <button class="toggle-replies-btn" data-parent="\${post.postId}">
      ▼ \${post.replies.length}件の返信
    </button>
    \`
  );

  toggleBtn = postEl.querySelector(
    \`.toggle-replies-btn[data-parent="\${post.postId}"]\`
  );
}

if (toggleBtn) {
  toggleBtn.textContent = openReplies.has(String(post.postId))
    ? '▲ 返信を隠す'
    : \`▼ \${post.replies.length}件の返信\`;
}
const currentUser = JSON.parse(
  document.getElementById("current-user").textContent
);

const deleteButtonHTML = currentUser.isAdmin ? \`
    <button class="delete-post-btn" data-postid="\${post.postId}">
      削除
      </button>\` : "";


  const reportButtonHTML =\`
  <button type="button" class="report-reply-btn js-reply-modal-open" data-postid="\${post.postId}">
  通報
 </button>

   <div class="modal js-reply-modal">
    <div class="modal-container">

    <button type="button" class="modal-close js-reply-modal-close">
     ×
    </button>


  <div class="modal-content">
    <h2>違反内容はなんですか?</h2>

    <form class="reasonForm">
     <input type="hidden" name="targetUserId" value="\${post.postId}">

     <div class="reason-list">
       <label>
        <input type="checkbox" name="reason" value="spam">
         スパム・宣伝行為
       </label>

       <label>
        <input type="checkbox" name="reason" value="defamation">
         誹謗中傷・暴言
       </label>

       <label>
        <input type="checkbox" name="reason" value="bad">
         不適切な内容・画像
       </label>

       <label>
        <input type="checkbox" name="reason" value="infomation">
         個人情報の投稿
       </label>

       <label>
        <input type="checkbox" name="reason" value="copyright">
         著作権の侵害
       </label>

       <label>
        <input type="checkbox" name="reason" value="danger">
         危険行為の助長
       </label>

       <label>
        <input
          type="checkbox"
          name="reason"
          value="others"
          class="replyotherCheck"
        >
         その他
       </label>
      </div>

      <div class="replyotherBox" style="display: none;">
       <textarea
         name="replyotherDetail"
         placeholder="理由を入力してください"
        ></textarea>
      </div>

      <button
        type="button"
        class="reply-reason-btn"
        data-postid="\${post.postId}"
      >
       通報する
      </button>
    </form>
   </div>

  </div>
</div>
\`
      ;

// 中身だけ更新する（.replies 自体は作り直さない）
repliesBox.innerHTML = post.replies.map(r => \`
  <div class="reply">
    <hr/>
      <strong>\${r.user.username}\${r.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</strong><br/>
      <img src="\${r.user.iconUrl || '/uploads/default.jpg'}" width="40">\${deleteButtonHTML}\${reportButtonHTML}<br/> 
      <div class="reply-content">\${r.content}<div>
      \${r.thumbnailUrl
        ? \`<img src="\${r.thumbnailUrl}" width="200" class="zoomable" data-full="\${r.imageUrl}">\`
        : ''}
      <small>\${new Date(r.createdAt).toLocaleString()}</small>
  </div>
\`).join('');

  });
  restoreOpenReplies();
}

async function fetchPosts() {
if (document.querySelector('.js-reply-modal.is-active')) {
    return;
  }

  try {
    const res = await fetch(\`/rooms/${roomId}/posts\`);
    const posts = await res.json();

    renderAllPosts(posts);
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}

  fetchPosts();
startPolling();

const replyotherCheck = document.getElementById('replyotherCheck');
const replyotherBox = document.getElementById('replyotherBox');

document.addEventListener('change', (e) => {
  if (!e.target.classList.contains('replyotherCheck')) return;

  const reply = e.target.closest('.reply');
  const otherBox = reply.querySelector('.replyotherBox');

  otherBox.style.display =
    e.target.checked ? 'block' : 'none';
});

document.addEventListener('click', (e) => {
  const openBtn = e.target.closest('.js-reply-modal-open');

  if (!openBtn) return;

   const reply = openBtn.closest('.reply');
  const modal = reply.querySelector('.js-reply-modal');
  if (modal?.classList.contains('js-reply-modal')) {
    modal.classList.add('is-active');
  }
});

document.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('.js-reply-modal-close');

  if (!closeBtn) return;

  const modal = closeBtn.closest('.js-reply-modal');

  if (modal) {
    modal.classList.remove('is-active');
  }
});

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('js-reply-modal-close')) {
    const modal = e.target.closest('.js-reply-modal');
    
    if (modal) {
      modal.classList.remove('is-active');
    } 
  }
});
  
document.addEventListener('click', async (e) => {
  if (!e.target.classList.contains('reply-reason-btn')) return;

   const reply = e.target.closest('.reply'); 

    const checkboxes = document.querySelectorAll('input[name="reason"]:checked');
    const arr = Array.from(checkboxes).map(cb => cb.value);
    
    const スパム宣伝行為 = arr.includes('spam') ? 'スパム宣伝行為' : '';
    const 誹謗中傷や暴言 = arr.includes('defamation') ? '誹謗中傷・暴言' : '';
    const 不適切な内容や画像 = arr.includes('bad') ? '不適切な内容・画像' : '';
    const 個人情報の投稿 = arr.includes('infomation') ? '個人情報の投稿' : '';
    const 著作権の侵害 = arr.includes('copyright') ? '著作権の侵害' : '';
    const 危険行為の助長 = arr.includes('danger') ? '危険行為の助長' : '';
    const その他理由 = arr.includes('others') ? document.querySelector('textarea[name="replyotherDetail"]').value : '';

    const username = reply.querySelector('strong').textContent;

    const content = reply.querySelector('.reply-content').textContent;
    const isReported = \`ルーム：${room.roomName}の\${username}さんの投稿:"\${content}"\`;

    const reportData = {
       isReported: isReported,
       reasons: [スパム宣伝行為, 誹謗中傷や暴言, 不適切な内容や画像, 個人情報の投稿, 著作権の侵害, 危険行為の助長, その他理由].filter(Boolean)
    };
    
    const res = await fetch(\`/admin/reports/posts\`, {
      method: 'POST',
      headers: { 'Content-Type' : 'application/json' },
      body: JSON.stringify(reportData)
    });

    if(res.ok) {
       alert('この投稿を通報しました');
    } else {
       alert('この投稿の通報に失敗しました。もう一度お試しください。');
    }

    if (res.ok) {
      const modal = reply.querySelector('.js-reply-modal');
       if (modal) {
         modal.classList.remove('is-active');
       }
    }
  });


// 画像クリックで拡大
document.addEventListener('DOMContentLoaded', () => {
  const imgModal = document.getElementById('imgModal');
  const modalImg = document.getElementById('modalImg');

  imgModal.addEventListener('click', () => { imgModal.style.display = 'none'; });

  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG' && e.target.classList.contains('zoomable')) {
      modalImg.src = e.target.dataset.full || e.target.src;
      imgModal.style.display = 'flex';
    }
  });
});

  </script>
  <div id="imgModal" style="
  display:none;
  position:fixed;
  inset:0;
  background:rgba(0,0,0,0.8);
  justify-content:center;
  align-items:center;
  z-index:9999;
">
  <img id="modalImg" src="" style="max-width:90%; max-height:90%; border-radius:8px;">
</div>

<script>

document.addEventListener('click', (e) => {
  if (!e.target.classList.contains('reply-btn')) return;

  const parentId = e.target.dataset.parent;
  const form = document.querySelector(
    \`.reply-form[data-parent="\${String(parentId)}"]\`
  );
  if (!form) return;

  const willOpen =
    form.style.display === 'none' ||
    getComputedStyle(form).display === 'none';

  form.style.display = willOpen ? 'block' : 'none';
});



// 返信一覧の開閉
const openReplies = new Set();
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-replies-btn');
  if (!btn) return;

  const parentId = String(btn.dataset.parent);
  const repliesBox = document.querySelector(
    \`.replies[data-parent="\${parentId}"]\`
  );
  if (!repliesBox) return;

  const isOpen = repliesBox.style.display === 'block';
  
  if (isOpen) {
    repliesBox.style.display = 'none';
    openReplies.delete(parentId);
  } else {
    repliesBox.style.display = 'block';
    openReplies.add(parentId);
  }
});

function restoreOpenReplies() {
  openReplies.forEach(parentId => {
    const repliesBox = document.querySelector(
      \`.replies[data-parent="\${parentId}"]\`
    );
    if (repliesBox) {
      repliesBox.style.display = 'block';
    }
  });
}


// 返信フォームの送信処理
document.addEventListener('submit', async (e) => {
  const form = e.target;

  if (!form.classList.contains('reply-form')) return;

  e.preventDefault();

  const parentId = form.dataset.parent;
  const content = form.querySelector('textarea[name="content"]').value;
  const fileInput = form.querySelector('input[name="icon"]');

  let imageUrl = null;
  let thumbnailUrl = null;

  if (fileInput.files.length > 0) {
    const fd = new FormData();
    fd.append('icon', fileInput.files[0]);
    const uploadRes = await fetch('/rooms/uploads', {
      method: 'POST',
      body: fd
    });
    const data = await uploadRes.json();
    imageUrl = data.url;
    thumbnailUrl = data.thumbnail;
  }

  const res = await fetch(\`/rooms/${roomId}/replies\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, parentId, imageUrl, thumbnailUrl }),
  });

  const reply = await res.json();

  const currentUser = JSON.parse(
    document.getElementById("current-user").textContent
  );
  const deleteButtonHTML = currentUser.isAdmin ? \`
    <button class="delete-post-btn" data-postid="\${reply.postId}">
      削除
    </button>\` : "";

  const parentPost = document.querySelector(
    \`.post[data-postid="\${parentId}"] .replies\`
  );

  if (parentPost) {
    parentPost.style.display = 'block';
  }

  form.reset();
  form.style.display = 'none';

  await fetchPosts();
});

</script>

<script>

const roomotherCheck = document.getElementById('roomotherCheck');
const roomotherBox = document.getElementById('roomotherBox');

 addEventListener('change', (e) => {
   if (e.target !== roomotherCheck) return;
   roomotherBox.style.display = 
     roomotherCheck.checked ? 'block' : 'none';
  });

  const roommodal = document.querySelector('.js-room-modal');
const roomopen = document.querySelector('.js-room-modal-open');
const roomclose = document.querySelector('.js-room-modal-close');

  function roommodalOpen() {
    roommodal.classList.add('is-active');
  }
  roomopen.addEventListener('click', roommodalOpen);

  function roommodalClose() {
   roommodal.classList.remove('is-active');
  }
  roomclose.addEventListener('click', roommodalClose);

  function roommodalOut(e) {
   if(e.target == roommodal) {
    roommodal.classList.remove('is-active');
   }
  }
  addEventListener('click', roommodalOut);

 document.querySelectorAll('.room-reason-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('input[name="reason"]:checked');
    const arr = Array.from(checkboxes).map(cb => cb.value);
    
    const スパムコミュニティ = arr.includes('spam') ? 'スパムコミュニティ' : '';
    const 荒らし目的 = arr.includes('vandalism') ? '荒らし目的' : '';
    const 危険な内容 = arr.includes('danger') ? '危険な内容' : '';
    const 不適切なルーム名や説明 = arr.includes('bad') ? '不適切なルーム名・説明' : '';
    const その他理由 = arr.includes('others') ? document.querySelector('textarea[name="roomotherDetail"]').value : '';
    
    const roomName = \`ルーム: ${room.roomName}\`;
    
    const reportData = {
      isReported: roomName,
      reasons: [スパムコミュニティ, 荒らし目的, 危険な内容, 不適切なルーム名や説明, その他理由].filter(Boolean)
    };
    
    const res = await fetch('/admin/reports/posts', {
       method: 'POST',
       headrs: { 'content-Type' : 'application/json' },
       body: JSON.stringify(reportData)
      });
      
      if(res.ok) {
        alert('このルームを通報しました');
      } else {
        alert('このルームの通報に失敗しました。もう一度お試しください。');
    }
        
    document.querySelector('.js-room-modal-close').click();
  });
 });
</script>
`);

});



// 通知オン／オフ切り替え
app.post('/:roomId/notify', async (c) => {
  const { user } = c.get('session') ?? {};
  if (!user?.userId) return c.redirect('/login');

  const { roomId } = c.req.param();
  const { notify } = await c.req.json();

  await prisma.userRoomSetting.upsert({
    where: { userId_roomId: { userId: user.userId, roomId } },
    update: { notify },
    create: { userId: user.userId, roomId, notify },
  });

  return c.json({ ok: true });
});
app.post('/:roomId/memo', async (c) => {
  const { user } = c.get('session') ?? {};
  const { roomId } = c.req.param();
  const body = await c.req.parseBody();
  const newMemo = body.memo;

  if (!user?.userId) {
    return c.text('ログインしてください', 401);
  }

  // ルームを取得
  const room = await prisma.room.findUnique({
    where: { roomId },
  });

  if (!room) {
    return c.text('ルームが見つかりません', 404);
  }

  // 作成者以外の編集を禁止
  if (room.createBy !== user.userId) {
    return c.text('編集権限がありません', 403);
  }

  // メモ更新
  await prisma.room.update({
    where: { roomId },
    data: { memo: newMemo },
  });

  return c.redirect(`/rooms/${roomId}`);
});

module.exports = app;