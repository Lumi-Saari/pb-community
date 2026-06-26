console.log("solution.js が読み込まれました");
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.solution-btn');
    if (!btn) return;

    const reportId = btn.dataset.reportId;
    const currentState = btn.dataset.solution === 'true';
    const newState = !currentState;

    // 二重送信防止
    btn.disabled = true;

    try {
      const res = await fetch(
        `/admin/reports/posts/${reportId}/solution`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            solution: newState,
          }),
        }
      );

      if (!res.ok) {
        throw new Error('更新失敗');
      }

      btn.dataset.solution = String(newState);
      btn.textContent = newState
        ? '✅ 解決'
        : '⚠️ 未解決';

    } catch (err) {
      console.error(err);
      alert('更新に失敗しました');
    } finally {
      btn.disabled = false;
    }
  });
});