const { Hono } = require('hono');
const { html } = require('hono/html');
const layout = require('../layout');
const ensureAuthenticated = require('../middlewares/ensure-authenticated');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });

const app = new Hono();

app.use(ensureAuthenticated());

app.get('/', (c) => {
  return c.html(
    layout(
      c,
      'アカウント管理',
      html`
      <h1>アカウント管理</h1>
      <a href="/">ホームへ戻る</a>
      <h3>ユーザー名の変更</h3>
        <form method="get" action="/account/change-name">
          <button type="submit">名前を変更する</button>
        </form>
      <h3>アイコン設定</h3>
        <form id="icon-form" method="POST" enctype="multipart/form-data" action="/account/user/icon">
         <input type="file" name="icon" accept="image/*" required />
        <button type="submit">アイコンをアップロード</button>
       </form>
      <h3>活動場所の設定</h3>
        <form method="get" action="/account/activity-place">
          <button type="submit">活動場所を設定・変更する</button>
        </form>
      <h3>自己紹介の設定</h3>
        <form method="get" action="/account/bio">
          <button type="submit">自己紹介を設定・変更する</button>
        </form>
        <h3>ログアウト</h3>
        <form method="get" action="/logout">
          <button type="submit">ログアウト</button>
        </form>
        <h3>アカウント削除</h3>
        <form method="post" action="/account/delete" onsubmit="return confirm('本当に退会しますか？')">
          <button type="submit">退会する</button>
        </form>
      `
    )
  );
});

app.get('/user/icon', (c) => {
  const session = c.get('session');
  const user = session?.user;
  if (!user) return c.redirect('/login');

  return c.html(`
    <h3>アイコンアップロード</h3>
    <form method="POST" enctype="multipart/form-data" action="/account/user/icon">
      <input type="file" name="icon" required />
      <button type="submit">アップロード</button>
    </form>
  `);
});
app.post('/user/icon', async (c) => {
  const session = c.get('session');
  const user = session?.user;
  if (!user) return c.redirect('/login');

  const formData = await c.req.parseBody();
  const iconFile = formData.icon;

  if (!iconFile || !iconFile.name) {
    return c.html(`
      <p>ファイルが選択されていません。</p>
      <a href="/account/user/icon">戻る</a> 
    `);
  }

  const uploadDir = path.join(__dirname, '../../public/uploads/');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // 保存先ファイルパス
  const fileName = `${user.userId}_${Date.now()}_${iconFile.name}`;
  const filePath = path.join(uploadDir, fileName);

  // Sharpでリサイズ＆圧縮
  const buffer = Buffer.from(await iconFile.arrayBuffer());
  await sharp(buffer)
    .resize(256, 256, { fit: 'inside' }) // 最大256x256にリサイズ
    .jpeg({ quality: 80 })              // JPEGで品質80%に圧縮
    .toFile(filePath);

  // DB更新
  const iconUrl = `/uploads/${fileName}`;
  await prisma.user.update({
    where: { userId: user.userId },
    data: { iconUrl },
  });

  // セッション更新
  session.user.iconUrl = iconUrl;

  return c.html(`
    <p>アイコンをアップロードしました。</p>
    <img src="${iconUrl}" alt="新しいアイコン" width="128" height="128">
    <a href="/account">アカウント管理へ戻る</a>
  `);
});


app.get('/change-name', (c) => {
  const session = c.get('session');
  const user = session.user;
  if (!user) return c.redirect('/login');

  return c.html(`
    <h3>ユーザー名の変更</h3>
    <form method="post" action="/setup-name">
      <label>ユーザー名: <input type="text" name="name" /></label>
      <button type="submit">決定</button>
    </form>
  `);
});

app.get('/activity-place', (c) => {
  const session = c.get('session');
  const user = session.user;
  if (!user) return c.redirect('/login');

  return c.html(`
    <h3>活動場所の設定</h3>
    <form method="post" action="/account/activity-place">
      <label>活動場所: <input type="text" name="activityPlace" /></label>
      <button type="submit">決定</button>
    </form>
  `);
});

app.post('/activity-place', async (c) => {
  const session = c.get('session');
  const user = session.user;
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();
  const activityPlace = body.activityPlace;

  try {
    await prisma.user.update({
      where: { userId: user.userId },
      data: { activityPlace },
    });

    // セッション情報も更新
    session.user.activityPlace = activityPlace;

    return c.html(`
      <p>活動場所を更新しました。</p>
      <a href="/account">アカウント管理へ戻る</a>
    `);
  }
  catch (err) {
    console.error('❌ Error:', err);
    return c.html(`
      <p>活動場所の更新に失敗しました。時間をおいて再度お試しください。</p>
      <a href="/account">アカウント管理へ戻る</a>
      ${err.message}
    `);
  }
});

app.get('/bio', async (c) => {
  const session = c.get('session');
  const userId = session?.user?.userId;
  if (!userId) return c.text('ログインしてください', 401);

  const user = await prisma.user.findUnique({
    where: { userId },
    select: { bio: true },
  });

  const bio = user?.bio || '';

  return c.html(`
    <h3>自己紹介の設定</h3>
    <form method="post" action="/account/bio">
      <label>自己紹介:
        <textarea name="bio" rows="4" cols="40" placeholder="${bio || '自己紹介を入力してください'}"></textarea>
      </label>
      <button type="submit">決定</button>
    </form>
  `);
});

app.post('/bio', async (c) => {
  const session = c.get('session');
  const user = session.user;
  if (!user) return c.redirect('/login');

  const body = await c.req.parseBody();
  const bio = body.bio;

  try {
    await prisma.user.update({
      where: { userId: user.userId },
      data: { bio },
    });

    // セッション情報も更新
    session.user.bio = bio;
    return c.html(`
      <p>自己紹介を更新しました。</p>
      <a href="/account">アカウント管理へ戻る</a>
    `);
  }
  catch (err) {
    console.error('❌ Error:', err);
    return c.html(`
      <p>自己紹介の更新に失敗しました。時間をおいて再度お試しください。</p>
      <a href="/account">アカウント管理へ戻る</a>
      ${err.message}
    `);
  }
});

app.post('/delete', async (c) => {
  const session = c.get('session');
  const userId = session?.user?.userId;

  if (!userId) {
    return c.html(layout(c, 'エラー', html`
      <p>ログイン情報がありません。再度ログインしてください。</p>
      <a href="/login">ログイン</a>
    `));
  }


  try {
    // ユーザーを論理削除
    await prisma.user.update({
      where: { userId },
      data: {
        username: `退会user_${userId.slice(0, 6)}`,
        isDeleted: true, // ← 論理削除フラグをセット
        bio: null,
        activityPlace: null,
        iconUrl:'/uploads/default.jpg'
      },
    });

    // 投稿を論理削除
    await prisma.RoomPost.updateMany({
      where: { userId },
      data: { isDeleted: true },
    });
    await prisma.privatePost.updateMany({
      where: { userId },
      data: { isDeleted: true },
    });

    // セッション破棄（ログアウト）
    c.set('session', null);

    return c.html(
      layout(
        c,
        '退会しました',
        html`
          <p>退会しました。ご利用ありがとうございました。</p>
          <a href="/">トップページへ</a>
        `
      )
    );
  } catch (err) {
    console.error('❌ Error:', err);
    return c.html(
      layout(
        c,
        'エラー',
        html`
          <p>退会に失敗しました。時間をおいて再度お試しください。</p>
          <a href="/account">アカウント管理へ戻る</a>
          ${err.message}
        `
      )
    );
  }
});



module.exports = app;