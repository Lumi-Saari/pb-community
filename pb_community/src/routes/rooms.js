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

app.get('/new', (c) => {
  return c.html(
  layout(
    c,
    'ルームの作成',
    html`
      <form method="post" action="/rooms">
        <div>
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
  const { user } = c.get('session') ?? {};
  const body = await c.req.parseBody();

  if (!user?.userId) return c.json({ error: 'ログインしてください' }, 401);

  if (!user || user.isDeleted) {
    return c.html(layout(c, 'エラー', html`
      <p>ログイン情報がありません。再度ログインしてください。</p>
      <a href="/login">ログイン</a>
    `));
  }

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
  orderBy: { createdAt: 'desc' },
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


 const { user } = c.get('session') ?? {};


const currentUser = {
  userId: user.userId,
  isAdmin: user.isAdmin,
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

    <!-- 返信一覧開閉ボタン（返信がある場合のみ） -->
<div id="reply-count-${p.postId}" data-count="${p.replyCount}">
  ${p.replyCount > 0 ? `
      <button class="toggle-replies-btn" data-parent="${p.postId}">
        ▼ ${p.replyCount}件の返信
      </button>
    ` : ''}
</div>

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

   <hr class="end"/>
  </div>
`).join('');

return c.html(`
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

<div id="postList">
  ${
    posts.length === 0
      ? '<p>投稿はまだありません</p>'
      : postList
  }
</div>

<div>
 ${roomisLocked ? '<p>このルームはロック中です。新しい投稿や返信はできません。</p>' : ''}
 ${!roomisLocked ? `
   <form id="postForm">
    <textarea name="content"></textarea>
    <input type="file" name="icon" accept="image/*">
    <button type="submit">投稿</button>
  </form>
  ` : ''}
</div>

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

<script id="current-user" type="application/json">
      ${JSON.stringify({
        userId: user.userId,
        isAdmin: user.isAdmin,
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

  return \`
    <div class="post" data-postid="\${post.postId}">
      <p>
        <strong>\${post.user.username}\${post.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</strong><br/>
        <img src="\${post.user.iconUrl || '/uploads/default.jpg'}" width="40">\${deleteButtonHTML}<br/>
        \${lockMessageHTML}
        \${unlockButtonHTML}
        \${post.content || ''}<br/>
        \${post.thumbnailUrl
          ? \`<img src="\${post.thumbnailUrl}" width="200" class="zoomable" data-full="\${post.imageUrl}">\`
          : ''}

        <small>\${new Date(post.createdAt).toLocaleString()}</small>
      </p>

      \${replyCount > 0 ? \`
        <button class="toggle-replies-btn" data-parent="\${String(post.postId)}">
         \${replyCount}件の返信
         </button>
         \` : ''}

      <div class="replies"
       data-parent="\${post.postId}"
       style="display:none">
  </div>

      \${!isLocked ? \`
          <form class="reply-form" data-parent="\${String(post.postId)}" style="display:none;">
           <textarea name="content" rows="2"></textarea>
           <input type="file" name="icon">
           <button type="submit">送信</button>
         </form>
          \` : ''}

      \${isLocked
        ? \`<div class="lock-message"> この返信はロック中です</div>\`
        : \`<button class="reply-btn" data-parent="\${String(post.postId)}">返信</button>\`
      }
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
      postEl.insertAdjacentHTML('beforeend',
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

// 中身だけ更新する（.replies 自体は作り直さない）
repliesBox.innerHTML = post.replies.map(r => \`
  <div class="reply">
    <hr/>
    <p>
      <strong>\${r.user.username}\${r.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</strong><br/>
      <img src="\${r.user.iconUrl || '/uploads/default.jpg'}" width="40">\${deleteButtonHTML}<br/> 
      \${r.content}<br/>
      \${r.thumbnailUrl
        ? \`<img src="\${r.thumbnailUrl}" width="200" class="zoomable" data-full="\${r.imageUrl}">\`
        : ''}
      <small>\${new Date(r.createdAt).toLocaleString()}</small>
    </p>
  </div>
\`).join('');

  });
  restoreOpenReplies();
}

async function fetchPosts() {
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

  const isHidden =
    repliesBox.style.display === 'none' ||
    getComputedStyle(repliesBox).display === 'none';

  repliesBox.style.display = isHidden ? 'block' : 'none';

  if (isHidden) {
    openReplies.add(parentId);
    btn.textContent = '▲ 返信を隠す';
  } else {
    openReplies.delete(parentId);
    const count = repliesBox.querySelectorAll('.reply').length;
    btn.textContent = \`▼ \${count}件の返信\`;
  }
});
function restoreOpenReplies() {
  openReplies.forEach((parentId) => {
    const repliesBox = document.querySelector(
      \`.replies[data-parent="\${parentId}"]\`
    );
    const toggleBtn = document.querySelector(
      \`.toggle-replies-btn[data-parent="\${parentId}"]\`
    );
    if (repliesBox && toggleBtn) {
      repliesBox.style.display = 'block';
      toggleBtn.textContent = '▲ 返信を隠す';
    }
  });
}


// 返信フォームの送信処理
document.querySelectorAll('.reply-form').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const parentId = form.dataset.parent;
    const content = form.querySelector('textarea[name="content"]').value;
    const fileInput = form.querySelector('input[name="icon"]');

    let imageUrl = null;
    let thumbnailUrl = null;

    if (fileInput.files.length > 0) {
      const fd = new FormData();
      fd.append('icon', fileInput.files[0]);
      const res = await fetch('/rooms/uploads', { method: 'POST', body: fd });
      const data = await res.json();
      imageUrl = data.url;
      thumbnailUrl = data.thumbnail;
    }

    await fetch(\`/privates/\${privateId}/replies\`, {
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

    const replyHtml = \`
      <div class="reply">
       <hr/>
        <p>
          <strong>\${reply.user.username}\${reply.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</strong><br/>
          <img src="\${reply.user.iconUrl || '/uploads/default.jpg'}" width="40">\${deleteButtonHTML}<br/> 
          \${reply.content}<br/>
          \${reply.thumbnailUrl ? \`<img src="\${reply.thumbnailUrl}" width="200" class="zoomable" data-full="\${reply.imageUrl}">\` : ''}
          <small>\${new Date(reply.createdAt).toLocaleString()}</small>
        </p>
      </div>
    \`;

   const parentPost = document.querySelector(
  \`.post[data-postid="\${parentId}"] .replies\`
);

if (parentPost) {
  parentPost.style.display = 'block';

  const postEl = document.querySelector(
    \`.post[data-postid="\${parentId}"]\`
  );

  const existingBtn = postEl.querySelector(
    \`.toggle-replies-btn[data-parent="\${String(parentId)}"]\`
  );
openReplies.add(String(parentId));
await fetchPosts();
}

    form.reset();
    form.style.display = 'none';
    await fetchPosts();
  });
});

</script>
`);

});



// 通知オン／オフ切り替え
app.post('/:roomId/notify', async (c) => {
  const { user } = c.get('session') ?? {};
  if (!user?.userId) return c.text('ログインしてください', 401);

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