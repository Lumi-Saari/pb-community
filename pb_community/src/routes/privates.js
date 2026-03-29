const { Hono } = require('hono')
const { html } = require('hono/html');
const layout = require('../layout');
const ensureAuthenticated = require('../middlewares/ensure-authenticated');
const requireAdmin = require('../middlewares/requireAdmin');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });


const app = new Hono();

function privateTable(privates) {
  return html`
    <table>
      <tbody>
        ${privates.map(
          (p) => html`
            <tr>
              <td>
                ・<a href="/privates/${p.privateId}">${p.privateName}</a>
              </td>
            </tr>
          `
        )}
      </tbody>
    </table>
  `;
}

app.use(ensureAuthenticated());
app.get('/new', (c) => {
  return c.html(
  layout(
    c,
    'プライベートルームの作成',
    html`
      <form method="post" action="/privates">
        <div>
          <h5>ルーム名 二十五文字まで</h5>
          <input type="text" name="privateName"  maxlength="25" />
        </div>
        <div>
          <h5>説明（なくてもOK）五十文字まで</h5>
          <textarea name="memo" rows="5" cols="40" maxlength="50" ></textarea>
        </div>
        <button type="submit">プライベートルームを作成</button>
      </form>
    `,
   ),
  );
});

 // プライベートルーム作成
app.post('/', async (c) => {
  const { user } = c.get('session') ?? {};
  const body = await c.req.parseBody();

  if (!user?.userId) {
    return c.json({ error: 'ログインしてください' }, 401);
  }

  if (!user || user.isDeleted) {
    return c.html(layout(c, 'エラー', html`
      <p>ログイン情報がありません。再度ログインしてください。</p>
      <a href="/login">ログイン</a>
    `));
  }

const privateRoom = await prisma.private.create({
  data: {
    privateId: randomUUID(),
    privateName: body.privateName || "名称未設定",
    memo: body.memo || "",
    createBy: user.userId,  
  },
  select: { privateId: true, privateName: true, updatedAt: true }
});

await prisma.privateMember.create({
  data: {
    privateId: privateRoom.privateId,
    userId: user.userId,
  },
});

return c.redirect('/privates/' + privateRoom.privateId);
});

app.post('/:privateId/invitation', async (c) => {
  const { user } = c.get('session') ?? {};
  const { privateId } = c.req.param();
  const body = await c.req.parseBody();
  const username = body.username; // 招待対象ユーザー名を取得

  if (!user?.userId) return c.text('ログインしてください', 401);

  // 招待先ルーム確認
  const room = await prisma.private.findUnique({ where: { privateId } });
  if (!room) return c.text('ルームが見つかりません', 404);

  // 作成者チェック
  if (room.createBy !== user.userId) {
    return c.text('このルームの作成者のみがメンバーを招待できます', 403);
  }

  // 招待対象ユーザー検索
  const invitee = await prisma.user.findUnique({ where: { username } });
  if (!invitee) return c.text('指定されたユーザーが見つかりません', 404);

  // すでにメンバーの場合はスキップ
  const existingMember = await prisma.privateMember.findUnique({
    where: { privateId_userId: { privateId, userId: invitee.userId } },
  });
  if (existingMember) {
    return c.text(`${invitee.username} さんはすでにメンバーです`, 400);
  }

  // メンバー追加
  await prisma.privateMember.create({
    data: { privateId, userId: invitee.userId },
  });

  // 招待メッセージ投稿
  await prisma.privatePost.create({
    data: {
      privateId,
      userId: user.userId,
      content: `${user.username} さんが ${invitee.username} さんを招待しました。`,
    },
  });

  // 通知作成
   await prisma.notification.create({
  data: {
    userId: invitee.userId,
    message: `${user.username} さんがあなたをプライベートルーム "${room.privateName}" に招待しました。`,
    url: `/privates/${privateId}`,
  },
});

  return c.redirect(`/privates/${privateId}`);
});


app.post('/:privateId/delete', async (c) => {
  const { user } = c.get('session') ?? {};
  const { privateId } = c.req.param();

  if (!user?.userId) return c.text('ログインしてください', 401);

  const room = await prisma.private.findUnique({
    where: { privateId },
  });
  if (!room) return c.text('ルームが見つかりません', 404);

  const isAdmin = user.isAdmin;

  if (room.createBy !== user.userId && !isAdmin) {
    return c.text('作成者または管理者のみがルームを削除できます', 403);
  }

  //  投稿を削除
  await prisma.privatePost.deleteMany({
    where: { privateId },
  });

  //  メンバーを削除
  await prisma.privateMember.deleteMany({
    where: { privateId },
  });

  //  ルームを削除
  await prisma.private.delete({
    where: { privateId },
  });

  return c.redirect('/');
});

app.post('/:privateId/member/exit', async (c) => {
  const { user } = c.get('session') ?? {};
  const { privateId } = c.req.param();

  if (!user?.userId) return c.text('ログインしてください', 401);

  const room = await prisma.private.findUnique({
    where: { privateId },
  });
  if (!room) return c.text('ルームが見つかりません', 404);

  // メンバーから削除
  await prisma.privateMember.deleteMany({
    where: {
      privateId,
      userId: user.userId,
    },
  });

  await prisma.privatePost.create({
    data: {
      privateId,
      userId: user.userId,
      content: `${user.username} さんがプライベートルームを退出しました。`,
    },
  })

  await prisma.notification.create({
    data: {
      userId: room.createBy,
      message: `${user.username} さんがプライベートルーム "${room.privateName}" から退出しました。`,
      url: `/privates/${privateId}`,
    },
  })

  return c.redirect('/');
})

app.get('/lists', async (c) => {
  const { user } = c.get('session') ?? {};

  if (!user) {
    return c.redirect('/login');
  }

  const privates = await prisma.private.findMany({
    where: {
      members: { some: { userId: user.userId } },
    },
    orderBy: { updatedAt: 'desc' },
    select: { privateId: true, privateName: true, updatedAt: true },
  });

  return c.html(
    layout(
      c,
      'プライベートルーム一覧',
      html`
      <a href="/">トップページに戻る</a>
      <h2>プライベートルーム一覧</h2>
      <h3>検索</h3>
      <form method="post" action="/privates/lists/search">
        <input type="text" name="q" placeholder="ルーム名で検索">
        <button type="submit">検索</button>
      </form>
      <hr/>
        ${privates.length > 0
          ? privateTable(privates)
          : html`<p>まだ招待されているプライベートルームはありません</p>`}
      `
    )
  );
});

app.get('/lists/search', async (c) => {
  const { user } = c.get(('session')) ?? {};

    if (!user) {
    return c.redirect('/login');
  }

  const q = c.req.query('q') || '';

  const rooms = await prisma.private.findMany({
    where: {
      privateName: { contains: q },
      members: { some: { userId: user.userId } },
    },
    orderBy: { updatedAt: 'desc' },
    select: { privateId: true, privateName: true, updatedAt: true },
  });

  return c.html(
    layout(
      c,
      'プライベートルーム検索結果',
      html`
      <a href="/privates/lists">プライベートルーム一覧に戻る</a>
        <h2>プライベートルーム検索結果</h2>
        ${rooms.length > 0
          ? privateTable(rooms)
          : html`<p>検索結果が見つかりませんでした</p>`}
      `
    )
  );
});

app.post('/lists/search', async (c) => {
  const body = await c.req.parseBody();
  const q = body.q || '';
  return c.redirect(`/privates/lists/search?q=${encodeURIComponent(q)}`);
});


app.get('/api/privates/:privateId/posts', async (req, res) => {
  const userId = req.session.userId;
  const privateId = req.params.privateId;

  const room = await db.getRoom(privateId);
  if (room.is_private) {
    const member = await db.getPrivateMember(privateId, userId);
    if (!member) {
      return res.status(403).json({ error: 'forbidden' });
    }
  }

  const posts = await db.getPosts(privateId);
  res.json(posts);
});

app.get('/:privateId/posts/search', async (c) => {
  const { privateId } = c.req.param();
  const q = c.req.query('q') || '';

  const posts = await prisma.privatePost.findMany({
    where: {
      privateId,
      content: { contains: q, mode: 'insensitive'},
      isDeleted: false,
    },
    orderBy: { createdAt: 'desc' },
    select: { content: true, postId: true, createdAt: true, imageUrl: true, thumbnailUrl: true, user: { select: { username: true, iconUrl: true } } },
  });

  return c.html(`
    <!doctype html>
    <html>
      <head>
        <title>投稿検索結果</title>
        <link rel="stylesheet" href="/stylesheets/style.css" />
        </head>
        <body>
        <a href="/privates/${privateId}">プライベートルームへ戻る</a>
        <h1>投稿検索結果</h1>
        <div>
          ${posts.length > 0 ? 
            posts.map(p => `
            <p>
      <strong>${p.user.username} ${p.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</strong><br/>
      <img src="${p.user.iconUrl || '/uploads/default.jpg'}" width="40">
      ${p.content || ''}<br/>
      ${p.thumbnailUrl ? `<img src="${p.thumbnailUrl}" width="200" class="zoomable" data-full="${p.imageUrl}">` : ''}
      <small>${new Date(p.createdAt).toLocaleString()}</small>
    </p>
            <hr/>
          `).join('') : '<p>検索結果が見つかりませんでした</p>'}
        </div>
      </body>
    </html>
  `);
});

app.post('/:privateId/posts/search', async (c) => {
  const { privateId } = c.req.param();  
  const body = await c.req.parseBody();
  const q = body.q || '';
  return c.redirect(`/privates/${privateId}/posts/search?q=${encodeURIComponent(q)}`);
});

app.get('/:privateId', async (c) => {
  const { privateId } = c.req.param();


const private = await prisma.private.findUnique({
  where: { privateId, },
  select: {
    privateName: true,
    isLocked: true,
    user: {
      select: {
        username: true
      }
    }
  }
});
  if (!private) return c.text('ルームが存在しません', 404);

  const memo = await prisma.Private.findUnique({
    where: { privateId },
    select: { memo: true }
  }).then(r => r?.memo);

 const posts = await prisma.privatePost.findMany({
  where: { privateId, isDeleted: false},
  orderBy: { createdAt: 'desc' },
  select: {
    postId: true,
    parentId: true,
    content: true,
    createdAt: true,
    imageUrl: true,
    thumbnailUrl: true,
    isLocked: true,
    user: {
      select: { username: true, iconUrl: true, isAdmin: true }
    }
  }
});

// 親投稿だけ
const parents = posts.filter(p => p.parentId === null);

const tree = parents.map(parent => ({
  ...parent,
  replies: posts.filter(p => p.parentId === parent.postId),
  replyCount: posts.filter(p => p.parentId === parent.postId).length
}));

 const { user } = c.get('session') ?? {};
if (!user?.userId) return c.redirect('/login');


const setting = await prisma.userRoomSetting.findFirst({
  where: {
    privateId,
    userId: user.userId,
  },
});

const currentUser = {
  userId: user.userId,
  isAdmin: user.isAdmin,
};

const privateisLocked = private.isLocked && !currentUser.isAdmin;

const deleteButtonHTML = (p) => 
  currentUser.isAdmin === true || currentUser.isAdmin === "true"
    ? `<button class="delete-post-btn" data-postid="${p.postId}">削除</button>`
    : "";

const lockMessageHTML = (p) => 
  currentUser.isAdmin === true || currentUser.isAdmin === "true"
    ? `<button class="posts-lock-btn" data-postid="${p.postId}">ロック</button>`
    : "";

const unlockMessageHTML = (p) => 
  currentUser.isAdmin === true || currentUser.isAdmin === "true"
    ? `<button class="posts-unlock-btn" data-postid="${p.postId}">ロック解除</button>`
    : "";

// 判定用フラグ
const notifyEnabled = !!(setting && setting.notify);

const isAdmin = user.isAdmin;

  const member = await prisma.privateMember.findFirst({
    where: {
      privateId,
      userId: user.userId,
    },
  });
  if (!(member || isAdmin)) {
    return c.text('アクセス権限がありません', 403);
  }

const postList = tree.map(p => {
  const isLocked = p.isLocked && !currentUser.isAdmin;
  return `
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
      <img src="${p.user.iconUrl || '/uploads/default.jpg'}" width="40">
      ${deleteButtonHTML(p)}<br/>
      ${lockMessageHTML(p)}
      ${unlockMessageHTML(p)}
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

        <!-- 返信ボタン -->
    ${!isLocked ? `
      <button class="reply-btn" data-parent="${p.postId}">返信</button>
    ` : ''}

    <!-- 返信フォーム -->
    <form class="reply-form" data-parent="${p.postId}" style="display:none;">
      ${!isLocked ? ` 
        <textarea name="content" rows="2" placeholder="返信を書く"></textarea>
        <input type="file" name="icon" accept="image/*">
        <button type="submit">送信</button>
      ` : ``}
    </form>

    <!-- ロックメッセージ -->
    ${isLocked ? `<div class="lock-message">この投稿はロック中です。返信できません。</div>` : ''}

    <hr class="end"/>
  </div>
`}).join('');

  return c.html(`
    <h1>${private.privateName}</h1>
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
    <a href="/privates/lists">プライベートルーム一覧に戻る</a>
    <h4>説明: ${memo || 'なし'}</h4>

    <h4>作成者: ${private.user.username} ${private.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</h4>

    <form method="POST" action="/privates/${privateId}/invitation">
     <input type="text" name="username" placeholder="招待する人の名前">
     <button type="submit">招待する</button>
    </form>

     <button id="notify-btn-private"
     data-private-id="${privateId}"
    data-notify="${notifyEnabled ? 'true' : 'false'}">
    ${notifyEnabled ? '🔔 通知オン' : '🔕 通知オフ'}
   </button>
    <script src="/notify.js"></script>

     <form action="/privates/${privateId}/memo" method="post">
  <textarea name="memo" rows="5" cols="40" maxlength="50" placeholder="ここに新しい説明"}></textarea>
  <button type="submit">更新</button>
   </form>

   <form method="GET" action="/privates/${privateId}/posts/search">
    <input type="text" name="q" placeholder="投稿を検索">
    <button type="submit">検索</button>
   </form>

    <form method="POST" action="/privates/${privateId}/member/exit" onsubmit="return confirm('退出すると、再招待されない限り入れません。本当に退出しますか？')">
      <button type="submit">プライベートルームから退出する</button>
     </form>

     <form method="POST" action="/privates/${privateId}/delete" onsubmit="return confirm('本当にこのルームを削除しますか？')">
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
 ${privateisLocked ? '<p>このプライベートルームはロック中です。新しい投稿はできません</p>' : ''}
 ${!privateisLocked ? `
  <form id="postForm">
    <textarea name="content"></textarea>
    <input type="file" name="icon" accept="image/*">
    <button type="submit">投稿</button>
  </form>
 ` : ''}
  <script id="current-user" type="application/json">
      ${JSON.stringify({
        userId: user.userId,
        isAdmin: user.isAdmin,
      })}
    </script>

 <script>
  const loading = document.getElementById('loading');
   const privateId = "${privateId}";
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

const LockMessageHTML =!isLocked && currentUser.isAdmin ? \`
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

const deleteButtonHTML =
  currentUser.isAdmin === true || currentUser.isAdmin === "true"
    ? \`<button class="delete-post-btn" data-postid="\${post.postId}">削除</button>\`
    : "";
  return \`
    <div class="post" data-postid="\${post.postId}">
      <p>
        <strong>\${post.user.username}\${post.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</strong><br/>
        <img src="\${post.user.iconUrl || '/uploads/default.jpg'}" width="40">\${deleteButtonHTML}<br/>
        \${LockMessageHTML}
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

  const content = form.querySelector('textarea[name="content"]').value;
  const fileInput = form.querySelector('input[name="icon"]');

  let imageUrl = null;
  let thumbnailUrl = null;

  if (fileInput.files.length > 0) {
    const formData = new FormData();
    formData.append('icon', fileInput.files[0]);
    const res = await fetch('/privates/uploads', { method: 'POST', body: formData });
    const data = await res.json();
    imageUrl = data.url;
    thumbnailUrl = data.thumbnail;
  }

  await fetch(\`/privates/${privateId}/posts\`, {
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

  const postId = e.target.dataset.postid;


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

    const res = await fetch(\`/privates/${privateId}/posts/\${postId}\`, {
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
  if(!btn) return;
  
  const postId = btn.dataset.postid;

  const confirmed = confirm('このポストの返信をロックしますか？');
  if(!confirmed) return;

  const res = await fetch(\`/privates/\${privateId}/posts/\${postId}/lock\`, {
    method: 'POST'
  });

  if(res.ok) { 
     alert('返信をロックしました。');
     location.reload();
  } else {
     alert('返信のロックに失敗しました。');
  }
});

document. addEventListener('click', async (e) => {
  const btn = e.target.closest('.posts-unlock-btn');
  if (!btn) return;
  
  const postId = btn.dataset.postid;

  const confirmed = confirm('このポストの返信のロックを解除しますか?');
  if(!confirmed) return;

  const res = await fetch(\`/privates/\${privateId}/posts/\${postId}/unlock\`, {
    method: 'POST'
  });

  if(res.ok) {
      alert('返信のロックを解除しました。');
      location.reload();
    } else {
      alert('返信のロックの解除に失敗しました。');
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
      \`.toggle-replies-btn[data-parent="\${String(post.postId)}"]\`
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
    const res = await fetch(\`/privates/${privateId}/posts\`);
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
      const res = await fetch('/privates/uploads', { method: 'POST', body: fd });
      const data = await res.json();
      imageUrl = data.url;
      thumbnailUrl = data.thumbnail;
    } 


    const res = await fetch(\`/privates/${privateId}/replies\`, {
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
          <strong>\${reply.user.username} \${reply.user.isAdmin ? '<span class="admin-badge">👑 管理者</span>' : ''}</strong><br/>
          <img src="\${reply.user.iconUrl || '/uploads/default.jpg'}" width="40">\${deleteButtonHTML}<br/>
          \${reply.content}<br/>
          \${reply.thumbnailUrl ? \`<img src="\${reply.thumbnailUrl}" width="200" class="zoomable" data-full="\${reply.imageUrl}">\` : ''}
          <small>\${new Date(reply.createdAt).toLocaleString()}</small>
        </p>
      </div>
    \`;

   const parentPost = document.querySelector(
  \`.post[data-postid="\${parentId}"] .replies\`
)

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
app.post('/:privateId/notify', async (c) => {
  const { user } = c.get('session') ?? {};
  if (!user?.userId) return c.text('ログインしてください', 401);

  const { privateId } = c.req.param();
  const { notify } = await c.req.json();

  await prisma.userRoomSetting.upsert({
    where: { userId_privateId: { userId: user.userId, privateId } },
    update: { notify },
    create: { userId: user.userId, privateId, notify },
  });

  return c.json({ ok: true });
});

app.post('/:privateId/memo', async (c) => {
  const { user } = c.get('session') ?? {};
  const { privateId } = c.req.param();
  const body = await c.req.parseBody();
  const newMemo = body.memo;

  if (!user?.userId) {
    return c.text('ログインしてください', 401);
  }

  // ルームを取得
  const room = await prisma.private.findUnique({
    where: { privateId },
  });

  if (!room) {
    return c.text('ルームが見つかりません', 404);
  }

  // 作成者以外の編集を禁止
  if (room.createBy !== user.userId) {
    return c.text('編集権限がありません', 403);
  }

  // メモ更新
  await prisma.private.update({
    where: { privateId },
    data: { memo: newMemo },
  });

  return c.redirect(`/privates/${privateId}`);
});

module.exports = app;