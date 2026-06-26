const { Hono } = require('hono');
const { html } = require('hono/html');
const layout = require('../layout');
const ensureAuthenticated = require('../middlewares/ensure-authenticated');
const requireAdmin = require('../middlewares/requireAdmin');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query']});

const app = new Hono();
app.get('/', async (c) => {
  const { user } = c.get('session');
  if(!user) return c.redirect('/login');

  const news = await prisma.News.findMany({
    orderBy: { createdAt: 'asc'},
  });

  const NewsPost = user.isAdmin ? html`
  <form method="POST" action="/news/posts">
    <label for="title">タイトル:</label>
    <input type="text" id="title" name="title" required><br><br>
    <label for="content">内容:</label>
    <textarea id="content" name="content" required></textarea><br><br>
    <button type="submit">お知らせを投稿</button>
  </form>
  ` : '';


    const deleteButtonHTML = (n) => 
      user.isAdmin === true || user.isAdmin === 'true'
    ? html`
      <form method="POST" action="/news/posts/${n.newsId}/delete">
       <button type="submit">削除</button>
      </form>
    `
    : "";

  const newsList = news.map(
    (n) => html`
    <p><strong>${n.title}</strong><br/>
    ${deleteButtonHTML(n)}<br/>
    ${n.content}<br/>
    <small>${new Date(n.createdAt).toLocaleString()}</small>
    </p>
    <hr/>
    
 `);

  return c.html(
    layout(
      c,
      'お知らせ',
      html`
        <h1>お知らせ</h1>
        <a href="/">トップページに戻る</a><br>

        <div id="NewsList">
         ${newsList || 'お知らせはありません。'}
        </div>
        <div>
         ${NewsPost}
        </div>
      `
    )
  );
});

app.post('/posts', requireAdmin(), async (c) => {
      const { user } = c.get('session');
  if(!user.isAdmin) return c.redirect('/news')

  const body = await c.req.parseBody();
  const title = body.title;
  const content = body.content;
  
  if (!title || !content) {
    return c.text('タイトルと内容は必須です。', 400);
  }

  const news = await prisma.News.create({
    data: { title,content},
  });

  return c.redirect('/news');
});

app.get('/posts', async (c) => {
  const news = await prisma.News.findMany({
    orderBy: { createdAt: 'asc' },
  });

  return c.json(news)
})


app.post('/posts/:newsId/delete', async (c) => {
  const { newsId } = c.req.param();
  const { user } = c.get('session');

  if (!user?.userId) return c.text('ログインしてください', 401);

  const news = await prisma.News.findUnique({
    where: { newsId },
  });
  if (!news) return c.text('ルームが見つかりません', 404);

  //  投稿を削除
  await prisma.News.deleteMany({
    where: { newsId },
  });

  return c.redirect('/news');
});

app.use(ensureAuthenticated()); 

module.exports = app;