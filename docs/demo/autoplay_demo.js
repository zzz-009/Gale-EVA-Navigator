/* Gale EVA Navigator 操作デモの自動再生（約 1 分）
 * 使い方: アプリを開いた画面で F12 → Console にこのファイルの中身を貼り付けて Enter。
 *         録画を始めてから貼り付けると、そのまま発表用のデモ動画になる。
 * 途中でやめる: __galeDemo.stop()
 * アプリのコードは変えない。画面のボタンを順に押し、字幕を重ねるだけ。
 * 再生は 3 倍速（足あとの移動はシミュレーション）。
 */
(() => {
  if (window.__galeDemo) window.__galeDemo.stop();
  let stopped = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const buttons = () => [...document.querySelectorAll('button')];
  const find = (text) => buttons().find((b) => !b.disabled && b.textContent.trim().includes(text));
  const click = (text) => { const b = find(text); if (b) b.click(); return !!b; };
  async function until(fn, max = 15000) {
    const t0 = Date.now();
    while (!stopped && Date.now() - t0 < max) { if (fn()) return true; await sleep(250); }
    return false;
  }

  // 字幕
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;max-width:78vw;padding:14px 26px;border-radius:14px;background:rgba(10,8,6,.88);color:#fff;font:600 26px/1.45 "Noto Sans JP","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;text-align:center;border:2px solid #e8764f;pointer-events:none';
  const clock = document.createElement('div');
  clock.style.cssText = 'position:fixed;right:18px;top:12px;z-index:99999;padding:4px 12px;border-radius:10px;background:rgba(10,8,6,.7);color:#bfb1a3;font:600 18px/1.4 sans-serif;pointer-events:none';
  document.body.append(box, clock);
  const t0 = Date.now();
  const tick = setInterval(() => { clock.textContent = `デモ ${Math.round((Date.now() - t0) / 1000)} 秒`; }, 500);
  const say = (text) => { box.textContent = text; box.style.display = text ? 'block' : 'none'; };

  async function run() {
    // 現場の画面なら計画に戻す
    if (find('計画に戻る')) { click('計画に戻る'); await sleep(1200); }

    say('① 基地で計画：実際の火星の地形（HiRISE）から、安全ルートを自動で計算');
    await sleep(5000);

    say('危険度のヒートマップを重ねて、周囲のリスクを確認');
    click('周辺の危険度');
    await sleep(4500);
    if (document.querySelector('[aria-pressed="true"]') && [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.textContent.includes('周辺の危険度'))) click('周辺の危険度');
    await sleep(500);

    // 3 倍速にして出発
    const speed = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text === '×3'));
    if (speed) { speed.value = [...speed.options].find((o) => o.text === '×3').value; speed.dispatchEvent(new Event('change', { bubbles: true })); }
    say('② 出発：足あとを記録（3 倍速・移動はシミュレーション）');
    click('このルートで出発');
    await sleep(6000);

    say('③ 通信が途切れた（圏外）：衛星なしの推測航法で記録を続け、誤差の円が広がる');
    const cb = document.querySelector('input[type=checkbox]');
    if (cb && !cb.checked) cb.click();
    await sleep(7000);

    say('通信が復帰：端末にたまった記録を、古い順に送る');
    if (cb && cb.checked) cb.click();
    await sleep(5000);

    say('④ 道に迷った！ 足あとを逆にたどる「来た道を戻る」へ');
    click('迷った');
    await sleep(5000);

    say('⑤ 来た道を戻る：足あとと目印で案内。酸素・バッテリーから帰還の限界を確認');
    await until(() => !!find('来た道を戻る'), 5000);
    click('来た道を戻る');
    await sleep(12000);

    say('通信がなくても、歩いて、戻れる。　Gale EVA Navigator');
    await sleep(5000);
    say('');
  }

  const stop = () => { stopped = true; clearInterval(tick); box.remove(); clock.remove(); };
  window.__galeDemo = { stop };
  run().then(() => { setTimeout(stop, 500); }).catch((e) => { console.error(e); stop(); });
})();
