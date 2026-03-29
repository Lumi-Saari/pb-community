const { Hono } = require('hono');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query']});
const { streamSSE } = require('hono/streaming');
const { addStream, removeStream } = require('../utils/eventStream');
const { broadcast } = require('../utils/eventStream');

const app = new Hono();

app.post('/:privateId/posts', async (c) => {
  const { privateId } = c.req.param();

 const { user } = c.get('session') ?? {};
  if (!user) return c.redirect('/login')
  
  const existingUser = await prisma.user.findUnique({ where: { userId: user.userId } });
  if (!existingUser) return c.text('ユーザーが存在しません', 400);

  // リクエストボディをまず読み込む
  const body = await c.req.json();
  const content = typeof body.content === 'string' ? body.content : null;
  const imageUrl = body.imageUrl ?? null;
  const thumbnailUrl = body.thumbnailUrl ?? null;
  
  // NGワードチェック（ここで content を使う）
  const bannedWords = [
    "殺す","殴る","蹴る","刺す","爆弾","危険",
    "バカ","死ね","ブス","キモい","アホ","差別","障害者","やめろ",
    "エロ","セックス","下ネタ","AV","裸","ちんこ","まんこ",
    "氏ね","クズ","死体","ゴミ","チンポ","チンチン",
    "@","gmail","yahoo","電話番号","住所"
  ];

  function containsBannedWords(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return bannedWords.some(word => lower.includes(word.toLowerCase()));
  }

  if (containsBannedWords(content)) {
    return c.text("!不適切な言葉が含まれています!", 400);
  }

  const private = await prisma.private.findUnique({ 
  where: { privateId },
  select: { privateName: true, isLocked: true },
 });

 if(!private) return c.text('このプライベートルームは存在しません', 404);
 if(!private.isLocked && !existingUser.isAdmin) {
  return c.text('このプライベートルームはロックされています。', 403);
 }

  const post = await prisma.PrivatePost.create({
  data: {
       privateId,
       userId: user.userId,
       content,
       imageUrl,
       thumbnailUrl,
       isLocked: false,
},
include: {
      user: {
        select: { username: true, iconUrl: true, isAdmin: true },
      },
      replies: {
      include: {
        user: { select: { username: true, iconUrl: true, isAdmin: true } },
        room: { select: { isLocked: true } },
      },
    },
   },
});

  broadcast(privateId, "postCreated", {
  postId: post.postId,
  user: {
    username: post.user.username,
    iconUrl: post.user.iconUrl,
    isAdmin: post.user.isAdmin,
  },
  content: post.content,
  imageUrl: post.imageUrl,
  thumbnailUrl: post.thumbnailUrl,
  createdAt: post.createdAt,
});

  // 通知対象の設定を取得
const settings = await prisma.userRoomSetting.findMany({
  where: {
    privateId,
    notify: true,
    NOT: { userId: user.userId },
  },
});

// 通知レコードを作成
await Promise.all(
  settings.map(s =>
    prisma.notification.create({
      data: {
        userId: s.userId,
        message: `${user.username} さんが${private.privateName}に投稿しました`,
        url: `/privates/${privateId}#post-${post.postId}`,
      },
    })
  )
);

return c.json(post)
});


app.get('/:privateId/posts', async (c) => {
  const { privateId } = c.req.param();

  const private = await prisma.private.findUnique({
    where: { privateId },
    select: { isLocked: true },
  });

  const posts = await prisma.PrivatePost.findMany({
    where: {
      privateId,
      parentId: null,   // ← これが超重要
      isDeleted: false,
    },
    orderBy: { createdAt: 'asc' },
    include: {
  user: { select: { username: true, iconUrl: true, isAdmin: true } },
  replies: {
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { username: true, iconUrl: true, isAdmin: true } },
    },
  },
},

  });

  return c.json(posts, private);
});

app.post('/:privateId/replies', async (c) => {
  const { user } = c.get('session') ?? {};
  if (!user?.userId) return c.text('ログインが必要です', 401);

  const { privateId } = c.req.param();
  const { content, parentId, imageUrl, thumbnailUrl } = await c.req.json();

  if (!parentId) return c.text('parentId が必要です', 400);

  // parentId を postId として検索
  const parent = await prisma.PrivatePost.findUnique({ where: { postId: parentId }, select: { isLocked: true } });
  if (!parent) return c.text('返信先の投稿が見つかりません', 404);
  if(parent.isLocked) return c.text('この投稿はロックされています。返信できません。', 403);

    // NGワードチェック（ここで content を使う）
  const bannedWords = [
    "殺す","殴る","蹴る","刺す","爆弾","危険",
    "バカ","死ね","ブス","キモい","アホ","差別","障害者","やめろ",
    "エロ","セックス","下ネタ","AV","裸","ちんこ","まんこ",
    "氏ね","クズ","死体","ゴミ","チンポ","チンチン",
    "@","gmail","yahoo","電話番号","住所"
  ];

  function containsBannedWords(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return bannedWords.some(word => lower.includes(word.toLowerCase()));
  }

  if (containsBannedWords(content)) {
    return c.text("!不適切な言葉が含まれています!", 400);
  }

  const reply = await prisma.PrivatePost.create({
  data: {
    privateId,
    userId: user.userId,
    parentId,
    content,
    imageUrl,
    thumbnailUrl,
  },
  include: {
    user: { select: { userId: true, username: true, iconUrl: true, isAdmin: true } },
  },
});

const post = await prisma.PrivatePost.findUnique({
  where: { postId: parentId, isDeleted: false },
  select: { content: true },
});

broadcast(privateId, "replyCreated", {
  replyId: reply.postId,
  parentId: reply.parentId,
  content: reply.content,
  imageUrl: reply.imageUrl,
  thumbnailUrl: reply.thumbnailUrl,
  createdAt: reply.createdAt,
  user: {
    username: reply.user.username,
    iconUrl: reply.user.iconUrl,
    isAdmin: reply.user.isAdmin,
  },
});


// 親投稿のユーザー
const parentUserId = reply.user.userId;
console.log("userId:", parentUserId);
// 自分自身には通知しない
if (parentUserId !== user.userId) {

  // 通知設定を確認（UserRoomSetting）
  const setting = await prisma.userRoomSetting.findFirst({
    where: {
      userId: parentUserId,
      privateId: privateId,
    }
  });

  if (setting?.notify) {
    await prisma.notification.create({
      data: {
        userId: parentUserId,
        message: `${user.username} さんが${post.content}に返信しました`,
        url: `/privates/${privateId}#post-${reply.postId}`, 
      }
    });
  }
}

const payload = {
  replyId: reply.postId,
  parentId: reply.parentId,
  content: reply.content,
  imageUrl: reply.imageUrl,
  thumbnailUrl: reply.thumbnailUrl,
  createdAt: reply.createdAt,
  user: {
    username: reply.user.username,
    iconUrl: reply.user.iconUrl,
    isAdmin: reply.user.isAdmin,
  }
};

broadcast(privateId, "replyCreated", payload);

  return c.json(reply);
});

 app.get('/:privateId/replies', async (c) => {
  const { privateId } = c.req.param();

  const reply = await prisma.PrivatePost.findMany({
    where: {
      privateId,
      isDeleted: false,
    },
    orderBy: { createdAt: 'asc' },
    include: {
      user: {
        select: { username: true, iconUrl: true, isAdmin: true },
      },
    },
  });

  broadcast(privateId, {
  event: "replyCreated",
  data: reply
});

  return c.json(reply);
});

app.delete('/:privateId/posts/:postId', async (c) => {
  const { postId } = c.req.param();
  const { user } = c.get('session') ?? {};
  if (!user) return c.redirect('/login')

  const existingUser = await prisma.user.findUnique({ where: { userId: user.userId } });
  if (!existingUser || !existingUser.isAdmin) {
    return c.text('管理者権限が必要です', 403);
  }

  const post = await prisma.PrivatePost.findUnique({ where: { postId } });
  if (!post) {
    return c.text('投稿が見つかりません', 404);
  }

  await prisma.PrivatePost.update({
    where: { postId },
    data: { isDeleted: true },
  });


  // 投稿者に通知を送る

  await prisma.notification.create({
    data: {
      userId: post.userId,
      message: `あなたの投稿が管理者によって削除されました`,
      url: `/privates/${post.privateId}`,
    },
  })

  return c.json({ ok: true });
});

app.post('/:privateId/posts/:postId/lock', async (c) => {
  const { postId } = c.req.param();
  const { user }  = c.get('session') ?? {};
   if(!user) return c.redirect('/login')
  const isAdmin = user.isAdmin;
   if(!isAdmin) return c.html(
    `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p> <a href ="/">トップページへ戻る</a>`,
    403
   );

   await prisma.privatePost.update({
    where: { postId },
    data: { isLocked: true }
   })

   return c.json({success: true, message: '返信をロックしました。'});
   });

app.post('/:privateId/posts/:postId/unlock', async (c) => {
  const { postId } = c.req.param();
  const { user } = c.get('session') ?? {};
   if (!user) return c.redirect('/login')
  const isAdmin = user.isAdmin;
   if (!isAdmin) return c.html(
    `<h1>アクセス拒否</h1><p>管理者権限が必要です。</p> <a href="/">トップページへ戻る</a>`,
    403
   );

   await prisma.privatePost.update({
    where:  { postId },
    data: {isLocked: false }
   });

  return c.json({success: true, message: '返信のロックを解除しました。'});
});

module.exports = app;