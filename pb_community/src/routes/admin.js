const { Hono } = require('hono')
const { html } = require('hono/html');
const layout = require('../layout');
const ensureAuthenticated = require('../middlewares/ensure-authenticated');
const requireAdmin = require('../middlewares/requireAdmin');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });
const admin = new Hono(); 

function roomTable(rooms) {
  return html`
    <table>
      <tbody>
        ${rooms.map(
          (room) => html`
            <tr>
              <td>
                ・<a href="/rooms/${room.roomId}">${room.roomName}</a> <button class="rooms-lock-btn" data-roomid="${room.roomId}">ロックする</button> <button class="rooms-unlock-btn" data-roomid="${room.roomId}">ロック解除</button>
              </td>
            </tr>
          `
        )}
      </tbody>
    </table>
  `;
}

function privateTable(privates) {
  return html`
    <table>
         <tbody>
          ${privates.map(
            (private) => html`
              <tr>
                <td>
                  .<a href="/privates/${private.privateId}">${private.privateName}</a> <button class="privates-lock-btn" data-privateid="${private.privateId}">ロックする</button><button class="privates-unlock-btn" data-privateid="${private.privateId}">ロック解除</button>
                </td>
              </tr>
            `
          )}
        </tbody>
      </table>
    `;
}
// 管理者用ページ
admin.get('/', async (c) => {
  const { user } = c.get('session');
  if (!user) return c.redirect('/login');

  if (!user.isAdmin) {
    return c.html(
        `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p><a href="/">トップページへ戻る</a>`,
        403
      )
  }

//TODO　後で

  return c.html(
    layout(
      c,
      '管理ページ',
      html`
        <h1>管理ページ</h1>
        <div>
          <a href="/">トップページへ戻る</a><br/><br/>
        </div>
        <div>
          <a href="/admin/users">ユーザー管理</a><br/>
          <br/>
          <a href="/admin/rooms">ルーム管理</a><br/>
          <br/>
          <a href="/admin/privates">プライベートルーム管理</a><br/>
          <br/>
          <a href="/admin/reports">通報管理</a>
        </div>
      `
    )
  );
});

admin.post('/ban/:userId',  async (c) => {
const { user } = c.get('session');
  if (!user) return c.redirect('/login')

  if (!user.isAdmin) {
    return c.html(
      `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p><a href="/">トップページへ戻る</a>`,
      403
    );
  }

  const { days } = await c.req.json();
  const { reason } = await c.req.json();

  let expires = null;

  if (days > 0) {
    expires = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000
    );
  }

  const { userId } = c.req.param();
  
  await prisma.user.update({
  where: { userId: userId },
  data: {
    isBanned: true,
    username: `BANuser_${userId.slice(0, 6)}`,
    BanReason: reason,
    BannedAt: new Date(),
    BanExpiresAt: expires,
    iconUrl: '/uploads/default.jpg',
    bio: null,
    activityPlace: null,

  },
});

  return c.json({ success: true, message: 'ユーザーをBANしました。' });
});

admin.post('/warn/:userId', async (c) => {

  const { user } = c.get('session');
  if (!user) return c.redirect('/login');

  if (!user.isAdmin) {
    return c.html(
      `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p><a href="/">トップページへ戻る</a>`,
      403
    );
  }

  const { warning } = await c.req.json();
  const { userId } = c.req.param();

  await prisma.notification.create({
    data: {
      userId: userId,
      message: `管理者からの警告: ${warning}`,
    }
  });

  return c.json({ message: '警告を送信しました' });
});

admin.post('/unban/:userId', async (c) => {
 const { user } = c.get('session');
 if (!user) return c.redirect('/login')

   if (!user.isAdmin) {
    return c.html(
      `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p><a href="/">トップページへ戻る</a>`,
      403
    );
  }

  const { userId } = c.req.param();

  await prisma.user.update({
    where: { userId: userId },
    data: {
      isBanned: false,
      BanReason: null,
      BanExpiresAt: null,
      username: `user_${userId.slice(0, 6)}`,
    },
  });

  return c.json({ success: true, message: 'ユーザーのBANを解除しました。' });
});

admin.post('/rooms/lock/:roomId', async (c) => {
  const { user } = c.get('session');
  if(!user) return c.redirect('/login')

  const isAdmin = user.isAdmin;
  if(!isAdmin) return c.html(
    `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p> <a href="/">トップページへ戻る</a>`,
    403
  )
  const { roomId } = c.req.param();

  await prisma.room.update({
    where: { roomId: String(roomId) },
    data: { islocked: true },
  });

  await prisma.roomPost.updateMany({
     where: { roomId },
     data: { isLocked: true }
  });

  return c.json({ success: true, message: 'ルームをロックしました。' });
});

admin.post('/rooms/unlock/:roomId', async (c) => {
  const { user } = c.get('session');
  if (!user) return c.redirect('/login')
  const isAdmin = user.isAdmin;
  if(!isAdmin) return c.html(
    `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p> <a href="/">トップページへ戻る</a>`,
    403
  )

  const { roomId } = c.req.param();

  await prisma.room.update({
    where: { roomId: String(roomId) },
    data: { islocked: false },
  });

  await prisma.roomPost.updateMany({
    where: { roomId },
    data: { isLocked: false }
  });

  return c.json({ success: true, message: 'ルームをロックしました' });
});

admin.post('/privates/lock/:privateId', async (c) => {
  const { privateId } = c.req.param();

  const { user } = c.get('session');
  if(!user) return c.redirect('/login');

  const isAdmin = user.isAdmin;
  if(!isAdmin) return c.html(
    `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p><a href="/">トップページへ戻る</a>`,
    403
  )

  await prisma.private.update({
    where: { privateId },
    data: { isLocked: true}
   });

  await prisma.privatePost.updateMany({
    where: { privateId, isLocked:false },
    data: { isLocked: true }
  })

  return c.json({ success: true, message: 'プライベートルームをロックしました。' });
});

admin.post ('/privates/unlock/:privateId', async (c) => {
  const { privateId } = c.req.param();

  const { user } = c.get('session');
  if(!user) return c.redirect('/login');

  const isAdmin = user.isAdmin;
  if(!isAdmin) return c.html(
    `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p> <a href="/">トップページへ戻る</a>`,
    403
  )

  await prisma.private.update({
    where: { privateId },
    data: { isLocked: false}
  });

  await prisma.privatePost.updateMany({
    where: { privateId },
    data: { isLocked: false }
  })

  return c.json({ success: true, message: 'プライベートルームのロックを解除しました。'})
})

// ユーザー管理ページ
admin.get('/users', requireAdmin(), async (c) => {
  const { user } = c.get('session');
  if (!user) return c.redirect('/login');


  if (!user.isAdmin) {
    return c.html(
        `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p><a href="/">トップページへ戻る</a>`,
        403
      )
  }


 const sort = c.req.query('sort') || 'created';

  // 必要な情報を全て取得

  const results = await prisma.user.findMany({
  //  where: { isAdmin: false },
    select: {
      userId: true,
      username: true,
      activityPlace: true,
      bio: true,
      iconUrl: true,
      createdAt: true,
    }, 
  });

  // ソート処理
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


  const userList = results.map(p => `
    <p><h3><img src="${p.iconUrl || '/uploads/default.jpg'}" alt="アイコン" width="50" height="50">
    <strong>${p.username ?? '名無しユーザー'} </h3></strong></p>
    <button class="ban-user-btn" data-userid="${p.userId}">BAN</button>
    <button class="unban-user-btn" data-userid="${p.userId}">BAN解除</button>
    <button class="warn-user-btn" data-userid="${p.userId}">警告</button>
    <p>活動場所: ${p.activityPlace ?? '未設定' }</p>
    <p>自己紹介: ${p.bio ?? '未設定' }</p>
    <hr/>
    `).join('');

  return c.html(`
    <!doctype html>
    <html>
      <head>
         <title>ユーザー管理</title>
         <link rel="stylesheet" href="/stylesheets/style.css" />
      </head>
      <body>
      <h1>ユーザー管理</h1>
      <a href="/admin">管理者ページへ戻る</a>
      <div>
        <a href="/admin/users?sort=name">あいうえお順</a> |
        <a href="/admin/users?sort=created">登録順（古い順）</a> |
        <a href="/admin/users?sort=latest">登録順（新しい順）</a>
      </div>
      <h3>ユーザー管理</h3>
      <script>
        document.addEventListener('click', async (e) => {
  const button = e.target.closest('.ban-user-btn');
  if (!button) return;

  const userId = button.getAttribute('data-userid');

    const days = prompt("BAN日数を入力 (0 = 永久BAN)")

  if (days === null ) return;

  const confirmed = confirm(\`\${days}日BANしますか？\`);
  if (!confirmed) return;

    const reason = prompt("BAN理由を入力してください");

   if (!reason) return; // キャンセルや空は中止

    const res = await fetch(\`/admin/ban/\${userId}\`, {
      method: "POST",
      headers: {"Content-Type" : "application/json" },
      body: JSON.stringify({ days: Number(days),reason: reason, }),
    });

    const data = await res.json();
    alert(data.message);
    location.reload();
  }
);

document.addEventListener('click', async (e) => {
  const button = e.target.closest('.unban-user-btn');
  if(!button) {
    console.log('unbanボタンではありません');
    return;
  }
  
  const userId = button.getAttribute('data-userid');
  const confirmed = confirm('BANを解除しますか？');
  if (!confirmed) return;

  const res = await fetch(\`/admin/unban/\${userId}\`, {
    method: "POST",
  });
  
  const data = await res.json();
  alert(data.message);
  location.reload();
}
);
 document.addEventListener('click', async (e) => {
  const button = e.target.closest('.warn-user-btn');
  if(!button) {
    console.log('warnボタンではありません');
    return;
  }
  
  const userId = button.getAttribute('data-userid');
  const warning = prompt('警告内容を入力してください');
  if (!warning) return;

  const confirmed = confirm('ユーザーに警告を送信しますか？');
  if (!confirmed) return;

  const res = await fetch(\`/admin/warn/\${userId}\`, {
    method: "POST",
    headers: {"Content-Type" : "application/json" },
    body: JSON.stringify({ warning }),
  });
  const data = await res.json();
  alert(data.message);
}
);
      </script>
      <form method="post" action="/admin/users/search">
       <input type="text" name="q" placeholder="ユーザー名で検索" />
       <button type="submit">検索</button>
      </form>
      <div id="userList">${userList}</div>
    </body>
    </html>
  `);
});

admin.get('/users/search', async (c) => {
  const { user } = c.get('session');
  if (!user) return c.redirect('/login');

  if (!user.isAdmin) {
    return c.html(
        `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p><a href="/">トップページへ戻る</a>`,
        403
      )
  }

  const q = c.req.query('q') || '';

  const results = await prisma.user.findMany({
    where: {
      username: { contains: q, mode: 'insensitive' },
      isAdmin: false,
    },
    select: {
      userId: true,
      username: true,
      activityPlace: true,
      bio: true,
      iconUrl: true,
      createdAt: true,
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
      <a href="/admin/users">ユーザー管理ページへ戻る</a>
      <h1>ユーザー検索結果</h1>
      <div>
       ${results.map(p => `
        <p><h3><img src="${p.iconUrl || '/uploads/default.jpg'}" alt="アイコン" width="50" height="50">
        <strong>${p.username ?? '名無しユーザー'}
        <p>活動場所: ${p.activityPlace ?? '未設定'}</p>
        <p>自己紹介: ${p.bio ?? '未設定'}</p>
        <hr/>
        `).join('') || '<p>該当するユーザーが見つかりませんでした。</p>'}
        </div>

      </body>
    </html>
       `)
});


admin.post('/users/search', async (c) => {
  const body = await c.req.parseBody();
  const q = body.q || '';
  return c.redirect(`/admin/users/search?q=${encodeURIComponent(q)}`);
})

admin.get('/rooms', requireAdmin(), async (c) => {
  const { user } = c.get('session');
  if (!user) return c.redirect('/login')

  const isAdmin = user.isAdmin
  if(!isAdmin) return c.html(
    `<h1>アクセス拒否<h1><p>管理者権限が必要です。</p><a href="/">トップページへ戻る</a>`,
    403
  )
  
const rooms = await prisma.room.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { roomId: true, roomName: true, updatedAt: true },
  });

  return c.html(
    layout(
      c,
       'ルーム一覧',
      html`
        <a href="/admin">管理者ページへ戻る</a>
        <h2>ルーム一覧</h2>
        <h3>検索</h3>
        <form method="get" action="/admin/rooms/search">
          <input type="text" name="q" placeholder="ルーム名で検索"/>
          <button type="submit">検索</button>
        </form>
        <hr/>
        ${rooms.length > 0
          ? roomTable(rooms)
          : html`<p>まだルームはありません</p>`}
        <script>
          document.querySelectorAll('.rooms-lock-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const roomId = btn.getAttribute('data-roomid');
              const confirmed = confirm('このルームをロックしますか？');
              if (!confirmed) return;
              
              const res = await fetch(\`/admin/rooms/lock/\${roomId}\`, {
                method: 'POST'
              });
              if (res.ok) {
                alert('ルームをロックしました');
                location.reload();
              } else {
                alert('ルームのロックに失敗しました');
              }
            });
          });
        </script>
        <script>
         document.querySelectorAll('.rooms-unlock-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const roomId = btn.getAttribute('data-roomid');

             const confirmed = confirm('このルームをロック解除しますか？');
             if (!confirmed) return;
             
             const res = await fetch(\`/admin/rooms/unlock/\${roomId}\`, {
               method: 'POST'
             });
             
              if (res.ok) {
                alert('ルームのロックを解除しました');
                location.reload();
              } else {
                alert('ルームのロックの解除に失敗しました。');
              }
          });
           });
        </script>
      `
    )
  );

});

admin.get('/rooms/search',  async (c) => {
  const { user } = c.get('session');
  if(!user) return c.redirect('/login')

  const isAdmin = user.isAdmin
  if(!isAdmin) return c.html(
    `<h1>アクセス拒否<h1><p>管理者権限が必要です。</p><a href="/">トップページへ戻る</a>`,
    403
  )

  const q = c.req.query('q') || '';
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
       <a href="/admin/rooms">ルーム一覧に戻る</a>
       <h2>ルーム検索結果: 「${q}」</h2>
        ${rooms.length > 0
          ? roomTable(rooms)
          : html`<p>該当するルームはありません</p>`}
      `
    )
  );
});

admin.post('/rooms/search', async (c) => {
    const body = await c.req.parseBody();
  const q = body.q || '';
  return c.redirect(`/rooms/lists/search?q=${encodeURIComponent(q)}`);
});

admin.get('/privates', async (c) => {
  const { user } = c.get('session');
  if(!user) return c.redirect('/login');

  const isAdmin = user.isAdmin;
  if(!isAdmin) return c.html(
    `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p> <a href="/">トップページへ戻る</a>`,
    403
  )

  const privates = await prisma.private.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { privateId: true, privateName: true, updatedAt: true}
  })

  return c.html(
    layout(
      c,
      'プライベートルーム一覧',
      html`
        <a href="/admin">管理者ページへ戻る</a>
        <h2>プライベートルーム一覧</h2>
        <h3>検索<h3>
        <form method="get" action="/admin/privates/search">
          <input type="text" name="q" placeholder="ルーム名で検索"/>
          <button type="submit">検索</button>
        </form>
       <hr/>
       ${privates.length > 0
         ? privateTable(privates)
         : html`<p>まだプライベートルームはありません。</p>`}
        <script>
         document.querySelectorAll('.privates-lock-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
             const privateId = btn.getAttribute('data-privateid');

             confirmed = confirm('このルームをロックしますか');
             if(!confirmed) return;

             const res = await fetch(\`/admin/privates/lock/\${privateId}\`, {
               method: 'POST'
              });

             if(res.ok) {
              alert('プライベートルームをロックしました。');
              location.reload();
             } else {
               alert('プライベートルームのロックに失敗しました');
             }
            });
          });
        </script>
        <script>
          document.querySelectorAll('.privates-unlock-btn').forEach(btn => {
           btn.addEventListener('click', async () => {
            const privateId = btn.getAttribute('data-privateid');

            confirmed = confirm('このルームのロックを解除しますか');
            if(!confirmed) return;

            const res = await fetch(\`/admin/privates/unlock/\${privateId}\`, {
              method: 'POST'
            });

            if(res.ok) {
             alert('プライベートルームのロックを解除しました。');
             location.reload();
            } else {
             alert('プライベートルームのロックに失敗しました。');
            }
           });
          });
        </script>
      `
    )
  );
});

admin.get('/privates/search', async (c) => {
  const { user } = c.get('session');
  if(!user) return c.redirect('/login');

  const isAdmin = user.isAdmin;
  if(!isAdmin) return c.html(
    `<h1>アクセス拒否</h1> <p>管理者権限が必要です</p> <a href="/">トップページへ戻る</a>`,
    403
  )
  const q = c.req.query('q') || '';
  const privates = await prisma.private.findMany({
    where: { 
      privateName: {
        contains: q,
      },
    },
    orderBy: { updatedAt: 'desc' },
    select: { privateId: true, privateName: true, updatedAt: true },
  });

  return c.html(
    layout(
      c,
      'プライベートルーム検索結果',
      html`
      <a href="/admin/privates">プライベートルーム一覧に戻る</a>
      <h2>プライベートルーム検索結果</h2>
      ${privates.length > 0
        ? privateTable(privates)
        : html`<p>該当するプライベートルームはありません</p>`}
      `
    )
  );
});

admin.post('/privates/search', async (c) => {
  const body = await c.req.parseBody();
  const q = body.q || '';
  return c.redirect(`/privats/lists/search?q=${encodeURIComponent(q)}`);
});

admin.use(ensureAuthenticated());  
admin.use(requireAdmin());

module.exports = admin;