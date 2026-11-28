(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app'), audio = $('#audio'), player = $('#player');
const LS = {
  get(k, d) { try { const v = localStorage.getItem('dr_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem('dr_' + k, JSON.stringify(v)); }
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// ---------- 英文新闻：中文译文 / 英文原文（默认中文，右上角一键切） ----------
let NLANG = LS.get('newsLang', 'zh');           // zh | en，记在本机
const hasZh = it => !!(it && (it.title_zh || it.intro_zh));
const origTitle = it => (it.title_en || it.title || '');
const origIntro = it => (it.intro_en || it.intro || '');
const dTitle = (it, lng) => (!lng || lng === 'zh') && it.title_zh ? it.title_zh : origTitle(it);
const dIntro = (it, lng) => (!lng || lng === 'zh') && it.intro_zh ? it.intro_zh : origIntro(it);
const zhTag = it => hasZh(it) ? '<i class="zhtag">译</i>' : '';
const langBtn = () => '<button class="langbtn" data-lang aria-label="切换中英文">' + (NLANG === 'zh' ? '中 / EN' : 'EN / 中') + '</button>';
function toggleLang() { NLANG = NLANG === 'zh' ? 'en' : 'zh'; LS.set('newsLang', NLANG); }
const fmt = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const mins = s => Math.max(1, Math.round((s || 0) / 60));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const md = d => { const [, m, dd] = d.split('-'); return (+m) + '月' + (+dd) + '日'; };
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 1800); }

let INDEX = null; const CACHE = {};
async function getIndex() { if (!INDEX) INDEX = await (await fetch('data/index.json', { cache: 'no-cache' })).json(); return INDEX; }
async function getIssue(d) { if (!CACHE[d]) CACHE[d] = await (await fetch('data/issues/' + d + '.json')).json(); return CACHE[d]; }

// ---------- 外部跳转（B站/小宇宙/微信读书/豆瓣） ----------
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const PLAT = { '小宇宙': ['🎙', '#7b5cff'], 'B站': ['📺', '#fb7299'], '喜马拉雅': ['🎧', '#f86442'], '网易云音乐': ['🎵', '#e60026'], 'YouTube': ['▶️', '#e62117'], '微信读书': ['📗', '#1b88ee'], '得到': ['📙', '#f4a100'], 'QQ音乐': ['🎵', '#31c27c'], 'TapTap': ['🎮', '#14c6cd'], 'Apple播客': ['🎙', '#9b45e0'], 'Steam': ['🎮', '#1b2838'], '腾讯视频': ['🎬', '#ff6022'], '爱奇艺': ['🎬', '#00be06'], '优酷': ['🎬', '#1f8fff'], '芒果TV': ['🎬', '#ff5f00'], 'Netflix': ['🎬', '#e50914'], 'Steam': ['🎮', '#1b2838'], '豆瓣': ['🫘', '#2e963d'], '原文': ['🔗', '#888'], '其他': ['🔗', '#888'] };
function schemeOf(platform, url, q) {
  if (platform === 'QQ音乐') {
    const m = /songDetail\/([0-9A-Za-z]+)/.exec(url || ''); if (!m) return '';
    return 'qqmusic://qq.com/media/playSonglist?p=' + encodeURIComponent(JSON.stringify({ song: [{ type: '0', songmid: m[1] }], action: 'play' }));
  }
  if (platform === '豆瓣') {
    const m = /(movie|book)\.douban\.com\/subject\/(\d+)/.exec(url || ''); if (!m) return '';
    return 'douban://douban.com/' + m[1] + '/' + m[2];
  }
  if (platform !== 'B站') return '';
  const m = /BV[0-9A-Za-z]{10}/.exec(url || ''); if (m) return 'bilibili://video/' + m[0];
  return q ? 'bilibili://search?keyword=' + q : '';
}
function openLink(url, scheme) {
  // 手机上先尝试唤起 App，1.2 秒内没跳走就打开网页版
  if (isMobile && scheme) {
    const t = Date.now(); location.href = scheme;
    setTimeout(() => { if (!document.hidden && Date.now() - t < 2500) window.open(url, '_blank'); }, 1200);
  } else window.open(url, '_blank', 'noopener');
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-url]'); if (!el) return;
  e.preventDefault(); openLink(el.dataset.url, el.dataset.scheme);
});
const APPLINK = /podcasts\.apple\.com|xiaoyuzhoufm\.com\/episode\/|youtube\.com\/watch|youtu\.be\/|bilibili\.com\/video\//;
const jump = (name, url, scheme) => { const p = PLAT[name] || PLAT['其他']; const app = scheme || APPLINK.test(url); return '<button class="jump' + (app ? ' app' : '') + '" style="--pc:' + p[1] + '" data-url="' + esc(url) + '" data-scheme="' + esc(scheme || '') + '">' + p[0] + ' ' + esc(name) + (app ? ' <i>App</i>' : '') + '</button>'; };
function workLinks(w) {
  const q = encodeURIComponent(String(w.name).replace(/[《》「」]/g, '').replace(/（.*?）|\(.*?\)/g, '').trim());
  const L = [];
  (w.links || []).forEach(l => L.push(jump(l.platform, l.url, schemeOf(l.platform, l.url))));
  if (w.url) L.push(jump(w.type === '播客' ? '小宇宙' : '原文', w.url));
  if (w.type === '书') { L.push(jump('微信读书', 'https://weread.qq.com/web/search/books?keyword=' + q)); L.push(jump('豆瓣', 'https://search.douban.com/book/subject_search?search_text=' + q)); }
  if (['电影', '纪录片', '剧', '课程', '动画'].includes(w.type)) { L.push(jump('B站', 'https://search.bilibili.com/all?keyword=' + q, schemeOf('B站', '', q))); L.push(jump('豆瓣', 'https://search.douban.com/movie/subject_search?search_text=' + q)); }
  return L.join('');
}
function mediaCard(m) {
  const p = PLAT[m.platform] || PLAT['其他'];
  return '<div class="mcard" style="--pc:' + p[1] + '" data-url="' + esc(m.url) + '" data-scheme="' + esc(schemeOf(m.platform, m.url)) + '">' +
    '<div class="mp">' + p[0] + ' ' + esc(m.platform) + '</div><div class="mt">' + esc(m.title) + '</div>' +
    '<div class="ma">' + esc(m.author || '') + (m.len ? ' · ' + esc(m.len) : '') + '</div><div class="mw">' + esc(m.why || '') + '</div>' +
    '<div class="tags">' + (m.scene ? '<span class="tag">适合：' + esc(m.scene) + '</span>' : '') + '<span class="tag go">去' + esc(m.platform) + ' ›</span></div></div>';
}

// ---------- 打卡 ----------
const done = () => LS.get('done', {});
function markDone(d, how) { const m = done(); if (!m[d]) { m[d] = how || 'read'; LS.set('done', m); toast('🌱 今日已完成，连续 ' + streak() + ' 天'); } }
function streak() {
  const m = done(); let n = 0; const t = new Date();
  for (let i = 0; i < 400; i++) {
    const x = new Date(t - i * 864e5); const k = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    if (m[k]) n++; else if (i > 0) break;
  }
  return n;
}

// ---------- 播放器 ----------
const P = { queue: [], idx: 0, meta: null, timer: null, timerEnd: 0 };
const RATES = [1, 1.25, 1.5, 1.75, 2, 0.9];
audio.playbackRate = LS.get('rate', 1);
function play(list, meta) {
  P.queue = list; P.idx = 0; P.meta = meta; loadCur(true);
}
function loadCur(autoplay) {
  const cur = P.queue[P.idx]; if (!cur) return;
  audio.src = cur.src; audio.playbackRate = LS.get('rate', 1);
  const pos = LS.get('pos', {})[cur.src];
  audio.addEventListener('loadedmetadata', function f() { audio.removeEventListener('loadedmetadata', f); if (pos && pos < audio.duration - 5) audio.currentTime = pos; }, { once: true });
  if (autoplay) audio.play().catch(() => toast('点一下 ▶ 开始播放'));
  player.classList.remove('hidden'); document.body.classList.add('has-player');
  $('.pl-title', player).textContent = cur.title;
  $('[data-act=rate]', player).textContent = audio.playbackRate + '×';
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: cur.title, artist: '每日深读 · ' + (P.meta?.column || ''), album: P.meta?.title || '每日深读', artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play()); ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('seekbackward', () => audio.currentTime -= 15); ms.setActionHandler('seekforward', () => audio.currentTime += 30);
    try { ms.setActionHandler('nexttrack', P.idx < P.queue.length - 1 ? () => { P.idx++; loadCur(true); } : null); } catch { }
  }
}
let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 0, c = audio.currentTime;
  $('.pl-fill', player).style.width = (d ? c / d * 100 : 0) + '%';
  $('.pl-seek', player).value = d ? Math.round(c / d * 1000) : 0;
  let t = fmt(c) + ' / ' + fmt(d);
  if (P.timerEnd) t += ' · ⏾ ' + fmt((P.timerEnd - Date.now()) / 1000);
  $('.pl-time', player).textContent = t;
  if (Date.now() - lastSave > 4000 && audio.src) { lastSave = Date.now(); const m = LS.get('pos', {}); m[P.queue[P.idx]?.src] = c; LS.set('pos', m); }
});
audio.addEventListener('play', () => $('[data-act=toggle]', player).textContent = '❚❚');
audio.addEventListener('pause', () => $('[data-act=toggle]', player).textContent = '▶');
audio.addEventListener('ended', () => {
  const cur = P.queue[P.idx]; const m = LS.get('pos', {}); delete m[cur?.src]; LS.set('pos', m);
  if (cur?.kind === 'deep' && P.meta) markDone(P.meta.date, 'listen');
  if (P.idx < P.queue.length - 1) { P.idx++; loadCur(true); toast('▶ 接着播：' + P.queue[P.idx].title); }
});
$('.pl-seek', player).addEventListener('input', e => { if (audio.duration) audio.currentTime = e.target.value / 1000 * audio.duration; });
player.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'toggle') audio.paused ? audio.play() : audio.pause();
  if (a === 'back') audio.currentTime -= 15;
  if (a === 'fwd') audio.currentTime += 30;
  if (a === 'rate') { const r = RATES[(RATES.indexOf(audio.playbackRate) + 1) % RATES.length]; audio.playbackRate = r; LS.set('rate', r); b.textContent = r + '×'; }
  if (a === 'timer') sheet('睡眠定时', [['15 分钟', () => setTimer(15)], ['30 分钟', () => setTimer(30)], ['播完本集', () => setTimer(-1)], ['取消定时', () => setTimer(0)]]);
});
function setTimer(m) {
  clearTimeout(P.timer); P.timerEnd = 0; const b = $('[data-act=timer]', player); b.classList.remove('on');
  if (m === -1) { P.queue = P.queue.slice(0, P.idx + 1); b.classList.add('on'); toast('本集播完自动停'); return; }
  if (!m) { toast('已取消定时'); return; }
  P.timerEnd = Date.now() + m * 6e4; b.classList.add('on');
  P.timer = setTimeout(() => { fadeOut(); P.timerEnd = 0; b.classList.remove('on'); }, m * 6e4);
  toast('⏾ ' + m + ' 分钟后渐弱停止');
}
function fadeOut() { let v = 1; const t = setInterval(() => { v -= .05; audio.volume = Math.max(0, v); if (v <= 0) { clearInterval(t); audio.pause(); audio.volume = 1; } }, 250); }
function sheet(title, opts) {
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = '<div><h4>' + esc(title) + '</h4><div class="btns">' + opts.map((o, i) => '<button class="btn ' + (i ? 'ghost' : '') + '" data-i="' + i + '">' + esc(o[0]) + '</button>').join('') + '</div></div>';
  el.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) opts[b.dataset.i][1](); if (b || e.target === el) el.remove(); });
  document.body.appendChild(el);
}

// ---------- 新栏目：今晚看 / 冷知识 / 站队 ----------
function pickHTML(d) {
  const p = d.pick; if (!p) return '';
  return '<section class="sec" id="pick"><div class="sec-h">🍿 今晚看</div><div class="pick">' +
    '<div class="pk-top"><span class="tag t">' + esc(p.type) + '</span>' + (p.rating ? '<span class="pk-rate">★ ' + esc(p.rating) + '</span>' : '') + '</div>' +
    '<div class="pk-name">《' + esc(p.name) + '》<small>' + esc([p.en, p.year].filter(Boolean).join(' · ')) + '</small></div>' +
    '<div class="pk-meta">' + esc([p.by, p.genre, p.len].filter(Boolean).join(' · ')) + '</div>' +
    '<p class="pk-hook">' + esc(p.hook) + '</p>' +
    (p.watch?.length ? '<div class="pk-wt">看点</div><ol class="pk-watch">' + p.watch.map(w => '<li>' + esc(w) + '</li>').join('') + '</ol>' : '') +
    '<div class="jumps">' + (p.where || []).map(w => jump(w.platform, w.url, schemeOf(w.platform, w.url))).join('') + '</div>' +
    (p.scene ? '<div class="tags" style="margin-top:8px"><span class="tag">适合：' + esc(p.scene) + '</span></div>' : '') + '</div></section>';
}
function snackHTML(d) {
  if (!d.snacks?.length) return '';
  return '<section class="sec"><div class="sec-h">🤯 离谱冷知识</div><div class="snacks">' + d.snacks.map((s, i) => '<div class="snack"><span class="sn-i">' + (i + 1) + '</span><b>' + esc(s.h) + '</b><p>' + esc(s.b) + '</p></div>').join('') + '</div></section>';
}
function pollHTML(d, date) {
  const ans = esc(LS.get('ans', {})[date]?.t || '');
  if (!d.poll) return '<section class="sec"><div class="sec-h">🌙 今晚想一想</div><div class="question">' + esc(d.question) + '</div><textarea id="ans" placeholder="写下你的答案（只存在这台手机上）">' + ans + '</textarea></section>';
  const v = LS.get('vote', {})[date];
  return '<section class="sec" id="poll"><div class="sec-h">🗳 你站哪边</div><div class="question">' + esc(d.poll.q) + '</div><div class="poll">' +
    ['a', 'b'].map(k => '<button class="pv' + (v === k ? ' on' : '') + '" data-v="' + k + '"><b>' + k.toUpperCase() + '</b><span>' + esc(d.poll[k]) + '</span></button>').join('') +
    '</div><textarea id="ans" placeholder="说说理由（可以不写，只存在这台手机上）">' + ans + '</textarea></section>';
}

// ---------- 今日 / 单期 ----------
const SCENES = {
  commute: { i: '🚇', n: '通勤', tip: d => '戴上耳机听两位主播对谈，' + mins(d.audio.deepSec) + ' 分钟正好一段地铁。锁屏也能控制。', acts: d => [['▶ 深听对谈 ' + mins(d.audio.deepSec) + '分钟', () => playDeep(d)], ['先听速览', () => playQuick(d)], ...(d.media?.length ? [['🎙 去听真人播客', () => $('#media')?.scrollIntoView({ behavior: 'smooth' })]] : [])] },
  gym: { i: '🏋️', n: '健身', tip: d => '组间不用看屏幕：速听 ' + mins(d.audio.quickSec) + ' 分钟后自动接上深听，可用 1.25× 倍速。', acts: d => [['▶ 速听 + 深听连播', () => play([qItem(d), dItem(d)], d)], ...(d.media?.length ? [['📺 去看视频/播客', () => $('#media')?.scrollIntoView({ behavior: 'smooth' })]] : [])] },
  shower: { i: '🚿', n: '洗澡', tip: d => '手机放远一点，' + mins(d.audio.quickSec) + ' 分钟速听刚好冲完一遍。', acts: d => [['▶ 速听 ' + mins(d.audio.quickSec) + '分钟', () => playQuick(d)]] },
  bed: { i: '🛏', n: '睡前', tip: d => '已切换护眼暗色。挑部今晚看的片，或者听着睡（30 分钟渐停）。', acts: d => [...(d.pick ? [['🍿 今晚看什么', () => $('#pick')?.scrollIntoView({ behavior: 'smooth' })]] : []), ['▶ 听着睡（30分钟渐停）', () => { playDeep(d); setTimer(30); }], ['只读文字', () => $('#art')?.scrollIntoView({ behavior: 'smooth' })]] }
};
const qItem = d => ({ src: d.audio.quick, title: '速听｜' + d.title, kind: 'quick' });
const dItem = d => ({ src: d.audio.deep, title: '深听｜' + d.title, kind: 'deep' });
const playQuick = d => play([qItem(d)], d), playDeep = d => play([dItem(d)], d);
function guessScene() {
  const h = new Date().getHours();
  if (h >= 22 || h < 5) return 'bed';
  if ((h >= 7 && h < 10) || (h >= 17 && h < 20)) return 'commute';
  return null;
}
async function viewIssue(date) {
  const idx = await getIndex();
  if (!idx.issues.length) { app.innerHTML = '<div class="wrap"><p class="muted">还没有内容</p></div>'; return; }
  if (!date) date = idx.issues[0].date;
  const d = await getIssue(date);
  const favs = LS.get('fav', {}); const isFav = !!favs['i:' + date];
  const scene = LS.get('scene_' + date, null) || guessScene();
  app.innerHTML = '<div class="wrap">' +
    '<div class="topline"><span>' + md(d.date) + ' ' + esc(d.weekday) + ' · <span class="badge">' + d.icon + ' ' + esc(d.column) + '</span></span><span class="streak">🔥 ' + streak() + ' 天</span></div>' +
    '<h1 class="title">' + esc(d.title) + '</h1><p class="subtitle">' + esc(d.subtitle) + '</p>' +
    '<div class="muted">🎧 深听 ' + mins(d.audio.deepSec) + ' 分钟 · 速听 ' + mins(d.audio.quickSec) + ' 分钟 · 📖 约 ' + Math.round(d.words / 450) + ' 分钟读完</div>' +
    '<div class="scenes">' + Object.entries(SCENES).map(([k, s]) => '<div class="scene ' + (k === scene ? 'on' : '') + '" data-scene="' + k + '"><b>' + s.i + '</b>' + s.n + '</div>').join('') + '</div>' +
    '<div class="scene-panel" id="sp"></div>' +
    '<section class="sec"><div class="sec-h">🔥 今天这事</div><p class="hook">' + esc(d.hook) + '</p><ul class="news">' +
    d.news.map(n => '<li><a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.t) + '</a><small>' + esc(n.src) + ' · ' + esc(n.date) + '</small></li>').join('') + '</ul></section>' +
    '<section class="sec"><div class="sec-h">⚡ 30 秒看懂</div><ol class="points">' + d.points.map(p => '<li>' + esc(p) + '</li>').join('') + '</ol></section>' +
    '<section class="sec article" id="art"><div class="sec-h">📖 故事</div>' + d.article.map(s => '<h3>' + esc(s.h) + '</h3>' + s.p.map(p => '<p>' + esc(p) + '</p>').join('')).join('') + '</section>' +
    pickHTML(d) + snackHTML(d) +
    '<section class="sec"><div class="sec-h">🗣 吵一架</div><div class="counter"><h3>' + esc(d.counter.h) + '</h3>' + d.counter.p.map(p => '<p>' + esc(p) + '</p>').join('') + '</div></section>' + pollHTML(d, date) +
    (d.media?.length ? '<section class="sec" id="media"><div class="sec-h">🎧 去听去看</div><p class="muted" style="margin:-4px 0 10px">真人播客和视频，点一下直接跳 App（没装就打开网页版）</p><div class="media">' + d.media.map(mediaCard).join('') + '</div></section>' : '') +
    (d.foryou?.length ? '<section class="sec"><div class="sec-h">😏 顺便一提</div><ul class="foryou">' + d.foryou.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul></section>' : '') +
    '<section class="sec"><div class="sec-h">📚 还想看</div><div class="works">' + d.works.map(w =>
      '<div class="work"><div class="wt"><span class="tag t">' + esc(w.type) + '</span><span class="wn">' + (w.url ? '<a href="' + esc(w.url) + '" target="_blank" rel="noopener">' + esc(w.name) + '</a>' : esc(w.name)) + '</span><span class="wa">' + esc(w.author) + '</span></div><div class="why">' + esc(w.why) + '</div><div class="tags"><span class="tag">适合：' + esc(w.scene) + '</span><span class="tag">' + esc(w.len) + '</span></div>' + (workLinks(w) ? '<div class="jumps">' + workLinks(w) + '</div>' : '') + '</div>').join('') + '</div></section>' +
    '<section class="sec"><details class="script"><summary>🎙 对谈文稿（' + d.deep.length + ' 段）</summary>' + d.deep.map(l => '<div class="line k-' + l.k + '"><b>' + esc(l.s) + '</b>' + esc(l.t) + '</div>').join('') + '</details></section>' +
    '<div class="done-bar"><div class="btns" style="justify-content:center"><button class="btn" id="done">' + (done()[date] ? '✓ 今日已完成' : '✅ 读完了，打卡') + '</button><button class="btn ghost" id="fav">' + (isFav ? '★ 已收藏' : '☆ 收藏本期') + '</button><button class="btn ghost" id="off">⬇ 离线音频</button></div><p class="muted">地铁信号差？先点「离线音频」把今天的两段音频存到手机里。</p></div>' +
    '</div>';
  const setScene = k => {
    document.querySelectorAll('.scene').forEach(e => e.classList.toggle('on', e.dataset.scene === k));
    document.body.classList.toggle('bed', k === 'bed');
    const sp = $('#sp'); if (!k) { sp.innerHTML = '<p>选一个场景，小白按场景给你排好今天的打开方式。</p>'; return; }
    const s = SCENES[k]; const acts = s.acts(d);
    sp.innerHTML = '<p>' + s.i + ' ' + esc(s.tip(d)) + '</p><div class="btns">' + acts.map((a, i) => '<button class="btn ' + (i ? 'ghost' : '') + '" data-a="' + i + '">' + esc(a[0]) + '</button>').join('') + '</div>';
    sp.onclick = e => { const b = e.target.closest('[data-a]'); if (b) acts[b.dataset.a][1](); };
  };
  setScene(scene);
  app.querySelector('.scenes').onclick = e => { const s = e.target.closest('[data-scene]'); if (!s) return; LS.set('scene_' + date, s.dataset.scene); setScene(s.dataset.scene); };
  app.querySelector('.poll')?.addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return; const m = LS.get('vote', {}); m[date] = b.dataset.v; LS.set('vote', m);
    app.querySelectorAll('.pv').forEach(x => x.classList.toggle('on', x === b)); toast('已站队：' + b.dataset.v.toUpperCase());
  });
  $('#ans').addEventListener('input', e => { const m = LS.get('ans', {}); m[date] = { t: e.target.value, q: d.question, ts: Date.now() }; LS.set('ans', m); });
  $('#done').onclick = e => { markDone(date); e.target.textContent = '✓ 今日已完成'; };
  $('#fav').onclick = e => { const f = LS.get('fav', {}); const k = 'i:' + date; if (f[k]) delete f[k]; else f[k] = { type: 'issue', date, title: d.title, ts: Date.now() }; LS.set('fav', f); e.target.textContent = f[k] ? '★ 已收藏' : '☆ 收藏本期'; };
  $('#off').onclick = async e => {
    if (!('caches' in window)) return toast('当前浏览器不支持离线');
    e.target.textContent = '下载中…';
    try { const c = await caches.open('dr-audio'); await c.addAll([d.audio.quick, d.audio.deep]); e.target.textContent = '✓ 已离线'; toast('两段音频已存到手机'); }
    catch { e.target.textContent = '⬇ 离线音频'; toast('下载失败，换个网络再试'); }
  };
  // 读到底自动打卡
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { markDone(date, 'read'); $('#done').textContent = '✓ 今日已完成'; io.disconnect(); } }, { threshold: 1 });
  setTimeout(() => io.observe($('.done-bar')), 30000); // 至少停留30秒才算读完
  window.scrollTo(0, 0);
}

// ---------- 刷卡 ----------
async function viewCards() {
  document.body.classList.remove('bed');
  const idx = await getIndex();
  const issues = await Promise.all(idx.issues.slice(0, 14).map(m => getIssue(m.date)));
  const favs = LS.get('fav', {});
  const cards = [];
  issues.forEach(d => d.cards.forEach((c, i) => cards.push({ ...c, d, i, n: d.cards.length })));
  app.innerHTML = '<div class="feed">' + cards.map((c, k) => {
    const key = 'c:' + c.d.date + ':' + c.i;
    return '<section class="fcard c' + (k % 2) + '" data-k="' + k + '"><div class="meta"><span>' + c.d.icon + ' ' + esc(c.d.column) + ' · ' + md(c.d.date) + '</span><span>' + (c.i + 1) + '/' + c.n + '</span></div>' +
      '<h2>' + esc(c.h) + '</h2><p>' + esc(c.b) + '</p><div class="src">—— 摘自《' + esc(c.d.title) + '》</div>' +
      '<div class="side"><button class="' + (favs[key] ? 'on' : '') + '" data-fav="' + k + '">♥</button><small>收藏</small><button data-go="' + c.d.date + '">📖</button><small>全文</small><button data-play="' + c.d.date + '">🎧</button><small>速听</small></div>' +
      (k === 0 ? '<div class="swipe-tip">↑ 上滑，下一张 · 双击收藏</div>' : '') + '</section>';
  }).join('') + '<section class="fcard"><h2>今天就刷到这儿 🌙</h2><p>比刷短视频多带走了 ' + cards.length + ' 个想法。<br>去「往期」挑一篇完整读读？</p></section></div><div class="heart">♥</div>';
  const feed = $('.feed');
  const toggleFav = k => {
    const c = cards[k]; const key = 'c:' + c.d.date + ':' + c.i; const f = LS.get('fav', {});
    if (f[key]) delete f[key]; else f[key] = { type: 'card', date: c.d.date, h: c.h, b: c.b, title: c.d.title, ts: Date.now() };
    LS.set('fav', f); feed.querySelector('[data-fav="' + k + '"]').classList.toggle('on', !!f[key]); return !!f[key];
  };
  feed.addEventListener('click', e => {
    const f = e.target.closest('[data-fav]'), g = e.target.closest('[data-go]'), p = e.target.closest('[data-play]');
    if (f) toggleFav(+f.dataset.fav);
    if (g) location.hash = '#/d/' + g.dataset.go;
    if (p) getIssue(p.dataset.play).then(playQuick);
  });
  let lastTap = 0;
  feed.addEventListener('touchend', e => {
    if (e.target.closest('button')) return;
    const now = Date.now(); if (now - lastTap < 300) { const s = e.target.closest('.fcard[data-k]'); if (s) { const on = toggleFav(+s.dataset.k); if (on) { const h = $('.heart'); h.classList.add('show'); setTimeout(() => h.classList.remove('show'), 600); } } }
    lastTap = now;
  });
  feed.addEventListener('dblclick', e => { const s = e.target.closest('.fcard[data-k]'); if (s) toggleFav(+s.dataset.k); });
}

// ---------- 往期 ----------
async function viewArchive() {
  document.body.classList.remove('bed');
  const idx = await getIndex(); const cols = [...new Set(idx.issues.map(i => i.column))];
  let cur = '全部';
  const render = () => {
    const list = idx.issues.filter(i => cur === '全部' || i.column === cur); const m = done();
    $('#list').innerHTML = list.map(i => '<a class="item ' + (m[i.date] ? 'read' : '') + '" href="#/d/' + i.date + '"><div class="d"><span>' + md(i.date) + ' ' + esc(i.weekday) + ' · ' + i.icon + ' ' + esc(i.column) + '</span><span>🎧' + mins(i.deepSec) + '′</span></div><div class="t">' + esc(i.title) + '</div><div class="s">' + esc(i.subtitle) + '</div></a>').join('') || '<p class="muted">这个栏目还没有内容</p>';
    document.querySelectorAll('.filters button').forEach(b => b.classList.toggle('on', b.dataset.c === cur));
  };
  app.innerHTML = '<div class="wrap"><h1 class="title">往期</h1><p class="muted">共 ' + idx.issues.length + ' 期 · 每周七个栏目轮换</p><div class="filters">' + ['全部', ...cols].map(c => '<button data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div><div id="list"></div></div>';
  $('.filters').onclick = e => { const b = e.target.closest('[data-c]'); if (b) { cur = b.dataset.c; render(); } };
  render();
}

// ---------- 我的 ----------
async function viewMe() {
  document.body.classList.remove('bed');
  const m = done(), favs = Object.values(LS.get('fav', {})).sort((a, b) => b.ts - a.ts), ans = LS.get('ans', {});
  const t = new Date(); const days = [];
  for (let i = 27; i >= 0; i--) { const x = new Date(t - i * 864e5); days.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')); }
  const fs = LS.get('fs', 17);
  app.innerHTML = '<div class="wrap"><h1 class="title">我的</h1>' +
    '<div class="stats"><div class="stat"><b>' + streak() + '</b><span>连续天数</span></div><div class="stat"><b>' + Object.keys(m).length + '</b><span>累计完成</span></div><div class="stat"><b>' + favs.length + '</b><span>收藏</span></div></div>' +
    '<div class="sec-h">最近 4 周</div><div class="cal">' + days.map(d => '<i class="' + (m[d] ? 'on ' : '') + (d === today() ? 'today' : '') + '" title="' + d + '"></i>').join('') + '</div>' +
    '<section class="sec"><div class="sec-h">★ 收藏</div>' + (favs.map(f => f.type === 'card' ? '<div class="fav"><b>' + esc(f.h) + '</b><br>' + esc(f.b) + '<br><a href="#/d/' + f.date + '" class="muted">《' + esc(f.title) + '》</a></div>' : '<a class="item" href="#/d/' + f.date + '"><div class="d"><span>' + md(f.date) + '</span><span>整期</span></div><div class="t">' + esc(f.title) + '</div></a>').join('') || '<p class="muted">刷卡时双击，或在文章底部点「收藏本期」</p>') + '</section>' +
    '<section class="sec"><div class="sec-h">✍️ 我的思考</div>' + (Object.entries(ans).filter(([, v]) => v.t?.trim()).sort((a, b) => b[0].localeCompare(a[0])).map(([d, v]) => '<div class="fav"><span class="muted">' + md(d) + ' · ' + esc(v.q) + '</span><br>' + esc(v.t) + '</div>').join('') || '<p class="muted">每期最后的思考题，答案都会收在这里</p>') + '</section>' +
    '<section class="sec"><div class="sec-h">⚙️ 设置</div><div class="btns"><button class="btn ghost sm" data-fs="-1">字号 −</button><span class="muted" style="align-self:center">正文 ' + fs + 'px</span><button class="btn ghost sm" data-fs="1">字号 +</button></div>' +
    '<p class="muted" style="margin-top:14px">📱 装到桌面：iPhone 用 Safari 打开 → 分享 → 「添加到主屏幕」；安卓用 Chrome → 菜单 → 「安装应用」。之后像 App 一样全屏打开。</p>' +
    '<div class="sec-h" style="margin-top:22px">📲 提前装好这些 App，跳转更顺</div><ul class="foryou">' +
      [['QQ音乐', '歌曲：直接打开并播放这首歌'], ['哔哩哔哩', '视频、MV、电影解说：直接打开视频或搜索结果'], ['小宇宙', '播客：直接打开那一集'], ['豆瓣', '电影、剧、书：直接打开条目看评分和短评'], ['腾讯视频', '电影、剧、综艺：先开网页搜索，再点「App 内打开」'], ['微信读书', '书：先开网页搜索，再点「打开 App」'], ['TapTap', '游戏：可选']].map(x => '<li><b>' + x[0] + '</b> — ' + x[1] + '</li>').join('') + '</ul>' +
      '<p class="muted">每天早上 7 点左右微信推送当天专题。收藏、打卡、思考只存在本机浏览器里。</p></div>';
  app.querySelector('.btns').onclick = e => { const b = e.target.closest('[data-fs]'); if (!b) return; const v = Math.min(23, Math.max(15, LS.get('fs', 17) + +b.dataset.fs)); LS.set('fs', v); applyFs(); viewMe(); };
}
function applyFs() { document.documentElement.style.setProperty('--fs', LS.get('fs', 17) + 'px'); }


// ---------- 刷（左右滑）+ 清单 ----------
const KIND = ['X', '新闻', '视频', '歌曲', '电影', '剧', '动画', '综艺', '纪录片', '书', '游戏', '播客'];
const KC = { 'X': '#16181c', '新闻': '#2b6fd6', '歌曲': '#e0457b', '电影': '#e07a2e', '剧': '#3e7bd6', '动画': '#f0a020', '综艺': '#d64fb0', '纪录片': '#2f9a6a', '书': '#9a6b3e', '游戏': '#14a0b8', '播客': '#7b5cff', '视频': '#e5484d' };
const KI = { 'X': '𝕏', '新闻': '📰', '歌曲': '🎵', '电影': '🎬', '剧': '📺', '动画': '🐱', '综艺': '🎤', '纪录片': '🌏', '书': '📖', '游戏': '🎮', '播客': '🎙', '视频': '▶️' };
// 歌曲只存 QQ 音乐链接，网易云 / B站搜索在这里现场拼
const linksOf = it => {
  const L = it.links || []; if (it.type !== '歌曲') return L;
  const q = encodeURIComponent(it.title + ' ' + (it.creator || '')), has = p => L.some(l => l.platform === p);
  return [...L, ...(has('网易云音乐') ? [] : [{ platform: '网易云音乐', url: 'https://music.163.com/#/search/m/?s=' + q + '&type=1' }]), ...(has('B站') ? [] : [{ platform: 'B站', url: 'https://search.bilibili.com/all?keyword=' + q }])];
};
const VERB = t => (t === '歌曲' || t === '播客') ? '去听' : t === '书' ? '去读' : t === '游戏' ? '去玩' : '去看';
const votesTxt = n => n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万人评' : n + '人评';
const rateHTML = it => it.rating ? '<span class="rate"><b>' + it.rating.toFixed(1) + '</b> 豆瓣' + (it.votes ? ' · ' + votesTxt(it.votes) : '') + '</span>' : '';
const posterHTML = (it, cls) => it.poster ? '<img class="' + cls + '" src="' + esc(it.poster) + '"' + (/^https?:/.test(it.poster) ? ' referrerpolicy="no-referrer"' : '') + ' loading="lazy" alt="" onerror="this.remove()">' : '';
const ago = t => { const s = Date.now() / 1000 - t; return s < 3600 ? Math.max(1, Math.round(s / 60)) + ' 分钟前' : s < 86400 ? Math.round(s / 3600) + ' 小时前' : Math.round(s / 86400) + ' 天前'; };
const mine = () => LS.get('mine', []);
let LIB = null, NEWS_AT = 0, MAN = null, LOADED = {}, LOADING = null;
async function loadType(t) {
  if (LOADED[t] || !MAN || !MAN.types[t]) return;
  try { LOADED[t] = await (await fetch(MAN.types[t].file)).json(); } catch { LOADED[t] = []; }
}
// 按需加载：选了某个类型只拉那一类；「全部」先拉小的几类马上能刷，其余后台补齐
async function getLib(need) {
  if (!MAN) {
    try { MAN = await (await fetch('data/lib_manifest.json', { cache: 'no-cache' })).json(); } catch { MAN = { types: {} }; }
    try { const n = await (await fetch('data/news.json', { cache: 'no-cache' })).json(); LOADED['新闻'] = n.items || []; NEWS_AT = n.updated || 0; } catch { LOADED['新闻'] = []; }
  }
  const want = need ? [need] : ['电影', '剧', '书', '游戏', '综艺', '纪录片', '动画'];
  await Promise.all(want.map(loadType));
  if (!need && !LOADING) LOADING = Promise.all(['歌曲', '视频', '播客'].map(loadType)).then(() => { LIB = null; });
  LIB = [...mine(), ...Object.values(LOADED).flat()];
  return LIB;
}
const swipes = () => LS.get('swipes', {}), saved = () => LS.get('saved', {});
function doSwipe(it, liked) {
  const s = swipes(); s[it.id] = { l: liked ? 1 : 0, t: it.type, g: it.tags, ts: Date.now() }; LS.set('swipes', s);
  const v = saved(); if (liked) v[it.id] = { item: it, ts: Date.now(), done: false }; else delete v[it.id]; LS.set('saved', v);
}
function undoSwipe(it) { const s = swipes(); delete s[it.id]; LS.set('swipes', s); const v = saved(); delete v[it.id]; LS.set('saved', v); }
function toggleSaved(it) { if (saved()[it.id]) doSwipe(it, false); else doSwipe(it, true); }
function taste(min = 2) {
  const like = {}, all = {};
  Object.values(swipes()).forEach(r => [...(r.g || []), r.t].forEach(t => { all[t] = (all[t] || 0) + 1; if (r.l) like[t] = (like[t] || 0) + 1; }));
  return Object.keys(all).filter(k => all[k] >= min).map(k => ({ tag: k, likes: like[k] || 0, total: all[k], rate: (like[k] || 0) / all[k] })).sort((a, b) => b.rate - a.rate || b.likes - a.likes);
}
// ---------- 推荐：我设的兴趣 + 左右滑/点开学到的口味（14 天半衰期），全在本机算 ----------
const INTR_DEF = { '大新闻': 2, '股票': 2, '政策': 2, '关注': 2 };
const INTR_TAGS = ['关注', '大新闻', '股票', '政策', '热搜', '财经', '半导体', 'AI', '美联储', '关税贸易', '黄金', '原油', '汇率', '房地产', '新能源', '机器人', '医药', '军工航天', '加密货币', '科技', '商业', '创业', '数码', '游戏'];
const LV = { '2': '多推', '0': '正常', '-1': '少推', '-3': '不看' };
const interest = () => ({ ...INTR_DEF, ...LS.get('interest', {}) });
function setInterest(t, v) { const m = LS.get('interest', {}); m[t] = v; LS.set('interest', m); DECK = []; }
function learned() {
  const now = Date.now(), L = {}, T = {};
  const add = (r, w, liked) => { const d = w * Math.pow(0.5, (now - (r.ts || now)) / 12096e5); [...new Set([...(r.g || []), r.t])].forEach(t => { T[t] = (T[t] || 0) + d; if (liked) L[t] = (L[t] || 0) + d; }); };
  Object.values(swipes()).forEach(r => add(r, 1, r.l));
  Object.values(LS.get('opens', {})).forEach(r => add(r, 0.5, 1));
  const o = {}; Object.keys(T).forEach(t => o[t] = ((L[t] || 0) + 1) / (T[t] + 2) - 0.5); return o;
}
function noteOpen(it) { const o = LS.get('opens', {}); o[it.id] = { t: it.type, g: it.tags, ts: Date.now() }; const ks = Object.keys(o); if (ks.length > 300) ks.sort((a, b) => o[a].ts - o[b].ts).slice(0, ks.length - 300).forEach(k => delete o[k]); LS.set('opens', o); }
const tagsOf = it => [...new Set([it.type, ...(it.tags || [])])];
const muted = (it, I) => tagsOf(it).some(t => I[t] <= -3);
function prefOf(it, I, M) {
  const ts = tagsOf(it), ex = ts.reduce((a, t) => a + (I[t] || 0), 0);
  const ln = (it.tags || []).filter(t => t !== '财经' && t !== it.creator && t !== 'X').reduce((a, t) => a + (M[t] || 0), 0);   // 类型、来源、「财经」太泛，不参与内容口味
  const tg = it.tags || [];
  return Math.max(-2, Math.min(4, ex)) * 0.6 + Math.max(-1, Math.min(1, ln)) * 1.1 + (tg.includes('公告') ? -1.2 : 0) + Math.min(2, (it.also || []).length) * 0.35;
}
const isFeed = it => it.type === '新闻' || it.type === 'X' || (it.tags || []).includes('关注');
const fresh = it => -(Date.now() / 1000 - (it.t || 0)) / 3600 / 8;
// 要闻推荐：兴趣 + 新鲜度；同一来源连着出会降权；每 10 条掺 1 条兴趣外的，避免越推越窄
function rankNews(list) {
  const I = interest(), M = learned(), sw = swipes(), ws = watch(), rd = readSet();
  const sc = list.filter(n => !sw[n.id] && !muted(n, I)).map(n => [prefOf(n, I, M) + fresh(n) + (aboutWatch(n, ws) ? 2.5 : 0) - (rd[n.id] ? 1.5 : 0), n]).sort((a, b) => b[0] - a[0]);
  const out = [], rest = sc.slice(), cnt = {};
  const other = rest.filter(x => !tagsOf(x[1]).some(t => I[t] > 0)).slice(0, 40);
  while (rest.length && out.length < 150) {
    let bi = 0, bs = -1e9;
    if (out.length % 10 === 9 && other.length) bi = rest.indexOf(other.shift());
    else for (let i = 0; i < Math.min(rest.length, 25); i++) { const v = rest[i][0] - (cnt[rest[i][1].creator] || 0) * 0.06; if (v > bs) { bs = v; bi = i; } }
    if (bi < 0) continue;
    const x = rest.splice(bi, 1)[0]; const oi = other.indexOf(x); if (oi >= 0) other.splice(oi, 1);
    cnt[x[1].creator] = (cnt[x[1].creator] || 0) + 1; out.push(x[1]);
  }
  return out;
}
const whyOf = (it, I, M) => { const w = aboutWatch(it, watch()); if (w) return '自选 ' + w.n; const a = tagsOf(it).filter(t => I[t] > 0); if (a.length) return '你关注 ' + a.slice(0, 2).join('、'); const b = tagsOf(it).filter(t => (M[t] || 0) > 0.15); return b.length ? '你常看 ' + b[0] : ''; };
let DECK = [], HIST = [], KSEL = null, SK = null, SDONE = false;
// 排序：右滑比例高的标签/类型优先 + 随机；「全部」按类型加权混排，避免一屏全是歌
// ---------- 歌曲细分：语种 / 风格 / 年代 / 谁来唱 / 场景，每组单选，组间同时生效 ----------
const SGROUPS = [['谁来唱', ['男生唱', '女生唱', '对唱', '组合']], ['年代', ['新歌', '20年代', '10年代', '00年代', '90年代', '老歌']],
  ['风格', ['流行', 'R&B', '说唱', '摇滚', '民谣', '电子', '古风', '原声', '爵士']], ['语种', ['国语', '粤语', '英文', '日语', '韩语', '闽南语']],
  ['场景', ['K歌', '经典', '抖音', '情歌', '伤感', '燃', '影视', '动漫']]];
let SSUB = LS.get('ssub', {});
const songSubOk = i => Object.values(SSUB).every(v => !v || (i.tags || []).includes(v));
// 新歌往前排：近两年 +，90 年代以前 −（只影响歌曲）
const songAgeBoost = i => { if (i.type !== '歌曲') return 0; const y = +(i.year || 0), p = i.pv ? 0 : -1.6; return p + (!y ? 0 : y >= 2024 ? 1.2 : y >= 2020 ? 0.7 : y >= 2015 ? 0.3 : y < 1995 ? -0.4 : 0); };   // 没试听的往后放
let SOPEN = null;   // 当前展开的细分组
function subBarHTML(lib) {
  if (KSEL !== '歌曲') return '';
  const cnt = {}; lib.forEach(i => { if (i.type === '歌曲') (i.tags || []).forEach(t => cnt[t] = (cnt[t] || 0) + 1); });
  const any = Object.values(SSUB).some(Boolean);
  const row = '<div class="kbar sbar">' + SGROUPS.map(([g]) => '<button data-sgo="' + g + '" class="' + (SSUB[g] ? 'on' : '') + (SOPEN === g ? ' open' : '') + '">' + esc(SSUB[g] || g) + '<i>▾</i></button>').join('') +
    (any ? '<button data-sclr class="clr">✕</button>' : '') + '</div>';
  const grp = SGROUPS.find(x => x[0] === SOPEN);
  const panel = grp ? '<div class="spanel"><button data-sg="' + grp[0] + '" data-sv="" class="' + (SSUB[grp[0]] ? '' : 'on') + '">不限</button>' +
    grp[1].filter(v => cnt[v] >= 30).map(v => '<button data-sg="' + grp[0] + '" data-sv="' + v + '" class="' + (SSUB[grp[0]] === v ? 'on' : '') + '">' + v + '<small>' + cnt[v] + '</small></button>').join('') + '</div>' : '';
  return row + panel;
}
function buildDeck(lib, keep = []) {
  const seen = new Set([...Object.keys(swipes()), ...keep.map(i => i.id)]), I = interest(), M = learned();
  const pool = lib.filter(i => !seen.has(i.id) && (!KSEL || i.type === KSEL) && (KSEL !== '歌曲' || songSubOk(i)) && !muted(i, I) && !(isFeed(i) && Date.now() / 1000 - (i.t || 0) > 48 * 3600));
  const score = i => prefOf(i, I, M) + (isFeed(i) ? fresh(i) : 0) + (i.id[0] === 'u' ? 3 : 0) + (i.views ? Math.min(0.6, Math.log10(i.views + 1) / 12) : 0) + (i.rating ? (i.rating - 8) * 0.25 : 0) + songAgeBoost(i) + Math.random() * 0.8;
  const ranked = pool.map(i => [score(i), i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  const out = [...keep];
  if (KSEL) out.push(...ranked.slice(0, 80));
  else {
    const q = {}; ranked.forEach(i => (q[i.type] = q[i.type] || []).push(i));
    while (out.length < keep.length + 60 && Object.keys(q).length) {
      const ks = Object.keys(q), w = ks.map(k => Math.max(0.25, 1 + 2 * (M[k] || 0)) * (k === '新闻' ? 3 : k === 'X' ? 1.5 : 1));
      let r = Math.random() * w.reduce((x, y) => x + y, 0), pick = ks[0];
      for (let j = 0; j < ks.length; j++) { if (r < w[j]) { pick = ks[j]; break; } r -= w[j]; }
      out.push(q[pick].shift()); if (!q[pick].length) delete q[pick];
    }
  }
  return out;
}
const kindBar = (sel, counts) => '<div class="kbar">' + [null, ...KIND].map(k => '<button data-k="' + (k || '') + '" class="' + (sel === k ? 'on' : '') + '" style="--kc:' + (k ? KC[k] : 'var(--ink)') + '">' + (k ? KI[k] + ' ' + k : '全部') + (counts && k && counts[k] ? ' ' + counts[k] : '') + '</button>').join('') + '</div>';

// ---------- 歌曲试听：Apple 官方 30 秒试听片段（多数落在副歌），App 内直接放，不跳转 ----------
const PV = new Audio(); PV.preload = 'auto';
let SONGPLAY = false, PVID = null;
const durS = s => { const p = String(s || '').split(':').map(Number); return p.length === 2 && p.every(isFinite) ? p[0] * 60 + p[1] : 0; };
let T2S = null;
const simp = s => [...(s || '').toLowerCase()].map(c => T2S && T2S[c] || c).join('').replace(/[\s\W_]/g, '');
const chOverlap = (a, b) => { const A = new Set([...simp(a)]); const B = [...simp(b)]; return B.length ? B.filter(c => A.has(c)).length / B.length : 0; };
const PVS = {};   // 预先配好的试听分片 data/pv/<id末位>.json
async function songPreview(it) {
  const k = (it.id.charCodeAt(it.id.length - 1) % 16).toString(16);
  if (!(k in PVS)) { try { PVS[k] = await (await fetch('data/pv2/' + k + '.json', { cache: 'no-cache' })).json(); } catch { PVS[k] = {}; } }
  if (PVS[k][it.id]) return PVS[k][it.id].replace(/^~/, 'https://audio-ssl.itunes.apple.com/itunes-assets/');
  const c = LS.get('pv', {}); if (it.id in c) return c[it.id];
  if (!T2S) { try { const d = await (await fetch('data/t2s.json')).json(); T2S = {}; [...d.t].forEach((c, i) => T2S[c] = [...d.s][i]); } catch { T2S = {}; } }
  const want = durS(it.len), live = /live|现场/i.test(it.title);
  let best = null, okReq = false;
  for (const cc of ['tw', 'hk']) {
    try {
      const rr = await fetch('https://itunes.apple.com/search?' + new URLSearchParams({ term: it.title.replace(/[（(].*$/, '') + ' ' + it.creator.split(/[、,&]/)[0], country: cc, entity: 'song', limit: 12 }));
      if (!rr.ok) continue; const j = await rr.json(); okReq = true;
      for (const x of j.results || []) {
        if (!x.previewUrl || (!live && /live|伴奏|instrumental|karaoke|remix|dj版/i.test(x.trackName))) continue;
        const d = Math.abs((x.trackTimeMillis || 0) / 1000 - want), art = Math.max(chOverlap(x.artistName, it.creator), chOverlap(it.creator, x.artistName)), tt = chOverlap(x.trackName, it.title);
        const okk = art >= 0.5 && tt >= 0.6 && (!want || d <= 15);
        const sc = (okk ? 100 : 0) - (want ? d : 0) + tt * 10;
        if (okk && (!best || sc > best.sc)) best = { sc, u: x.previewUrl };
      }
    } catch { }
    if (best) break;
  }
  const u = best ? best.u : ''; if (!okReq) return '';   // 网络/限流失败不记缓存，下次再试
  c[it.id] = u; const ks = Object.keys(c); if (ks.length > 3000) delete c[ks[0]]; LS.set('pv', c);
  return u;
}
function pvUI() {
  const b = document.querySelector('[data-a=go]'), top = DECK[0];
  if (b) b.textContent = '↗';
  const bar = document.querySelector('.sw-card:last-child .pvbar i'); if (bar) bar.style.width = (PV.duration ? PV.currentTime / PV.duration * 100 : 0) + '%';
  const st = document.querySelector('.sw-card:last-child .pvst'); if (st && top && !st.dataset.miss) { const on = PVID === top.id && !PV.paused, h = on ? ICO_PAUSE : ICO_PLAY; if (st.innerHTML !== h) st.innerHTML = h; st.classList.toggle('on', on); st.classList.toggle('ld', PVID === top.id && SONGPLAY && PV.paused); }
}
PV.addEventListener('timeupdate', pvUI); PV.addEventListener('play', pvUI); PV.addEventListener('pause', pvUI);
PV.addEventListener('ended', () => { SONGPLAY && toast('试听完了，想听完整版点「去听」'); pvUI(); });
async function playSong(it) {
  if (PVID !== it.id) PV.pause();   // 先停上一首，别让旧声音盖住新卡
  PVID = it.id; pvUI();
  const u = await songPreview(it);
  if (PVID !== it.id) return;
  if (!u) { PV.pause(); const st = document.querySelector('.sw-card:last-child .pvst'); if (st) { st.innerHTML = ICO_MUTE; st.dataset.miss = 1; st.classList.add('miss'); } toast('这首没有试听，点 ↗ 去 QQ 音乐'); return; }
  const au = document.getElementById('audio'); if (au && !au.paused) au.pause();
  if (PV.src !== u) PV.src = u;
  try { await PV.play(); } catch { SONGPLAY = false; }
  pvUI();
}
const ICO_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';
const ICO_PAUSE = '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>';
const ICO_MUTE = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function toggleSong() { const t = DECK[0]; if (!t) return; if (SONGPLAY && PVID === t.id && !PV.paused) { SONGPLAY = false; PV.pause(); } else { SONGPLAY = true; playSong(t); } pvUI(); }
function stopSong() { PV.pause(); PVID = null; }
// 换卡时：连播模式下自动放下一首的试听，否则停
function songOnTop() {
  const top = DECK[0];
  if (top && top.type === '歌曲' && SONGPLAY) playSong(top); else if (!top || PVID !== top.id) stopSong();
  if (!top || top.type !== '歌曲') { /* 刷到非歌曲卡：停但保留连播开关 */ PV.pause(); }
  pvUI();
  const nx = DECK.slice(1, 3).find(x => x.type === '歌曲'); if (nx && SONGPLAY) songPreview(nx);   // 预取下一首
}

// ---------- 热榜：微博 / 抖音 / B站 / 百度 / 头条 聚合 + AI 联网速览（刚刚发生 / 为什么上热搜 / X） ----------
let HOT = null, HOTAI = null, HSEL = '全网', HOT_AT = 0;
const HTABS = ['全网', '微博', '抖音', 'B站', '百度', '头条', 'X'];
const HB = { '微博': ['weibo'], '抖音': ['douyin'], 'B站': ['bili', 'bilivideo'], '百度': ['baidu'], '头条': ['toutiao'] };
const SRCC = { '微博': '#ff8200', '抖音': '#1e2330', 'B站热搜': '#fb7299', 'B站': '#fb7299', '百度': '#2b6fd6', '头条': '#e5484d' };
const sago = t => { const s = Date.now() / 1000 - t; return s < 3600 ? Math.max(1, Math.round(s / 60)) + '分钟' : s < 86400 ? Math.round(s / 3600) + '小时' : Math.round(s / 86400) + '天'; };
const heat = n => !n ? '' : n >= 1e8 ? (n / 1e8).toFixed(1) + '亿' : n >= 1e4 ? Math.round(n / 1e4) + '万' : String(n);
async function loadHot() {
  const [a, b] = await Promise.allSettled([fetch('data/hot.json', { cache: 'no-cache' }).then(r => r.json()), fetch('data/hot_ai.json', { cache: 'no-cache' }).then(r => r.json())]);
  if (a.status === 'fulfilled') HOT = a.value; if (b.status === 'fulfilled') HOTAI = b.value; HOT_AT = Date.now();
}
async function viewHot() {
  document.body.classList.remove('bed');
  if (!HOT || Date.now() - HOT_AT > 3 * 6e4) await Promise.all([loadHot(), Date.now() - LIVE_AT > 6e4 ? fetchLive().catch(() => 0) : 0]);
  const L = [];   // 点击用：[url, platform]
  const lk = (u, p) => { L.push([u, p]); return ' data-h="' + (L.length - 1) + '"'; };
  const srcs = s => s.map(x => '<span class="hsrc" style="background:' + (SRCC[x] || '#888') + '">' + esc(x.replace('热搜', '')) + '</span>').join('');
  const render = () => {
    L.length = 0;
    const ai = HOTAI || {}, ex = {}; (ai.explain || []).forEach(e => ex[e.title] = e);
    let h = '<div class="wrap"><div class="shelf-head"><h1 class="title" style="margin:0;font-family:var(--sans);font-weight:800">热榜 <span class="muted" style="font-size:13px;font-weight:400">' + (HOT ? ago(HOT.updated) + '更新' : '') + '</span></h1><button class="icon" data-hr aria-label="刷新">↻</button></div>' +
      '<div class="srcbar">' + HTABS.map(t => '<button data-ht="' + t + '" class="' + (HSEL === t ? 'on' : '') + '">' + t + '</button>').join('') + '</div>';
    if (!HOT) h += '<p class="muted">热榜还没拉到，稍后点 ↻。</p>';
    else if (HSEL === '全网') {
      // 刚刚发生 = 7×24 快讯里最近 1 小时的重要条目（分钟级）+ AI 联网搜到的国内外新闻，按时间合并
      const now = Date.now() / 1000;
      const fl = LIVE.filter(n => now - n.t < 3600).sort((a, b) => (b.tags.includes('大新闻') - a.tags.includes('大新闻')) || b.t - a.t).slice(0, 5)
        .map(n => ({ t: n.t, cat: '快讯', title: n.title, summary: n.intro, source: n.creator, url: n.links[0].url }));
      const fr = [...fl, ...(ai.fresh || [])].sort((a, b) => b.t - a.t).slice(0, 12);
      if (fr.length) h += '<div class="hsec">⚡ 刚刚发生 <span class="muted">快讯实时 · AI 联网 ' + ago(ai.updated || now) + '</span></div><div class="hcard">' +
        fr.map(f => '<div class="hfresh"' + lk(f.url, '原文') + '><time>' + sago(f.t) + '</time><div><b><i class="hcat"' + (f.cat === '快讯' ? ' style="background:#e5484d"' : '') + '>' + esc(f.cat) + '</i>' + esc(f.title) + '</b>' + (f.summary ? '<p>' + esc(f.summary) + '</p>' : '') + '<small>' + esc(f.source) + '</small></div></div>').join('') + '</div>';
      h += '<div class="hsec">🔥 全网都在聊 <span class="muted">多个平台同时上榜的排前面</span></div><div class="hcard">' +
        HOT.merged.slice(0, 40).map((m, i) => { const e = ex[m.title]; return '<div class="hm"' + lk(m.links[0].url, m.links[0].platform) + '><i class="rk' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</i><div><b>' + esc(m.title) + '</b>' + (e ? '<p>' + esc(e.what) + '</p><p class="why">💬 ' + esc(e.why) + '</p>' : m.desc ? '<p>' + esc(m.desc) + '</p>' : '') + '<div class="hsrcs">' + srcs(m.srcs) + '</div></div></div>'; }).join('') + '</div>';
      h += '<p class="muted" style="font-size:12px">榜单每几分钟从各平台公开热榜抓一次；「刚刚发生」和「为什么上热搜」由 AI 联网搜索整理，一天更新几次，可能有误，点开看原文。</p>';
    } else if (HSEL === 'X') {
      const xs = (ai.xposts || []);
      h += xs.length ? '<div class="hcard">' + xs.map(p => '<div class="hfresh"' + lk(p.url, 'X') + '><time>' + sago(p.t) + '</time><div><b><i class="hcat">' + esc(p.cat) + '</i>' + esc(p.title) + '</b><p>' + esc(p.summary) + '</p><small>@' + esc(p.handle) + (p.likes >= 1000 ? ' · ❤ ' + Math.round(p.likes / 1000) + 'k' : '') + '</small></div></div>').join('') + '</div>' : '<p class="muted">X 热帖还没更新。</p>';
    } else {
      for (const bid of HB[HSEL]) {
        const b = HOT.boards.find(x => x.id === bid); if (!b) continue;
        if (HB[HSEL].length > 1) h += '<div class="hsec">' + esc(b.name) + '</div>';
        h += '<div class="hcard">' + b.items.map((x, i) => x.pic && bid === 'bilivideo'
          ? '<div class="hv"' + lk(x.url, 'B站') + '><img src="' + esc(x.pic) + '" referrerpolicy="no-referrer" loading="lazy" alt=""><div><b>' + esc(x.title) + '</b><small>' + esc(x.by) + ' · ' + heat(x.heat) + '播放' + (x.why ? ' · ' + esc(x.why) : '') + '</small></div></div>'
          : '<div class="hm"' + lk(x.url, HSEL) + '><i class="rk' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</i><div><b>' + esc(x.title) + (x.label ? ' <em class="hlab">' + esc(x.label) + '</em>' : '') + '</b>' + (ex[x.title] ? '<p>' + esc(ex[x.title].what) + '</p>' : x.desc ? '<p>' + esc(x.desc) + '</p>' : '') + (x.heat ? '<small>🔥 ' + heat(x.heat) + '</small>' : '') + '</div></div>').join('') + '</div>';
      }
    }
    app.innerHTML = h + '</div>';
  };
  app.onclick = async e => {
    const t = e.target.closest('[data-ht]'); if (t) { HSEL = t.dataset.ht; render(); window.scrollTo(0, 0); return; }
    if (e.target.closest('[data-hr]')) { toast('刷新中…'); await Promise.all([loadHot(), fetchLive().catch(() => 0)]); render(); toast('已更新'); return; }
    const r = e.target.closest('[data-h]'); if (r) { const [u, p] = L[+r.dataset.h]; r.classList.add('rd'); openLink(u, schemeOf(p, u)); }
  };
  render(); window.scrollTo(0, 0);
}
function cardHTML(it) {
  const song = it.type === '歌曲', wide = it.type === '视频' || it.type === '新闻' || (it.type === '游戏' && /^https?:/.test(it.poster || ''));
  const right = (it.type === '新闻' || it.type === 'X') && it.t ? ago(it.t) : (it.len && !wide ? esc(it.len) : '');
  const ref = p => esc(p) + '"' + (/^https?:/.test(p) ? ' referrerpolicy="no-referrer"' : '');
  let media;
  if (it.poster && wide) media = '<img class="full" src="' + ref(it.poster) + ' loading="lazy" alt="" onerror="this.remove()">' + (it.len ? '<span class="dur">' + esc(it.len) + '</span>' : '');
  else if (it.poster) media = '<img class="bgblur" src="' + ref(it.poster) + ' alt="" onerror="this.remove()"><img class="cover" src="' + ref(it.poster) + ' loading="lazy" alt="" onerror="this.remove()">';
  else if (it.type === 'X') media = '<div class="lyr" style="font-size:44px">𝕏<small>' + esc((it.intro.match(/^@[\w]+/) || ['X 热帖'])[0]) + ' · ' + esc(it.tags[1] || '') + '</small></div>';
  else if (song && it.hook) media = '<div class="lyr">「' + esc(it.hook) + '」</div>';
  if (song) media += '<div class="pvst" aria-label="播放">' + ICO_PLAY + '</div><div class="pvbar"><i></i></div>';
  else media = '<div class="ico">' + (KI[it.type] || '✨') + '</div>';
  if (it.rating) media += rateHTML(it);
  const by = [it.creator, it.year].filter(Boolean).join(' · ');
  const showHook = it.hook && !(song && !it.poster);
  const di = dIntro(it);
  const intro = !song && di && !(it.hook && di.startsWith(it.hook)) ? di : (it.meta || '');
  return '<div class="sw-card" style="--kc:' + (KC[it.type] || '#888') + '"><div class="sw-media">' + media + '</div>' +
    '<div class="sw-info"><div class="row"><span class="kchip">' + (KI[it.type] || '✨') + ' ' + esc(it.type) + '</span>' + (it.id[0] === 'u' ? '<span class="kchip mine">我添加的</span>' : '') + '<span class="muted">' + right + '</span></div>' +
    '<div class="t">' + zhTag(it) + esc(dTitle(it)) + '</div>' + (by ? '<div class="by">' + esc(by) + '</div>' : '') +
    (showHook ? '<div class="hk">' + (song ? '「' + esc(it.hook) + '」' : esc(it.hook)) + '</div>' : '') +
    (intro ? '<p class="it">' + esc(intro) + '</p>' : '') +
    '<div class="tg">' + it.tags.slice(0, 4).map(t => '#' + esc(t)).join('  ') + '</div></div>' +
    '<div class="stamp like">想要</div><div class="stamp nope">跳过</div></div>';
}
const rowHTML = (i, n, done) => '<div class="lrow' + (done ? ' done' : '') + '" data-n="' + n + '"><span class="lic" style="background:' + (KC[i.type] || '#888') + '22">' + (KI[i.type] || '✨') + '</span><div class="lt"><b>' + esc(dTitle(i)) + (i.rating ? ' <em class="rt">' + i.rating.toFixed(1) + '</em>' : '') + '</b><small>' + esc([i.type, i.creator, i.year].filter(Boolean).join(' · ')) + '</small>' + (i.hook ? '<small class="lh">' + esc(i.hook) + '</small>' : '') + '</div></div>';

function openDetail(it, onChange) {
  noteOpen(it); markRead(it.id);
  const el = document.createElement('div'); el.className = 'sheet';
  const render = () => {
    const s = saved()[it.id], song = it.type === '歌曲';
    const ttl = dTitle(it, NLANG), intro = dIntro(it, NLANG);
    const langbar = hasZh(it) ? '<div class="langbar"><button data-lg="zh" class="' + (NLANG === 'zh' ? 'on' : '') + '">中文译文</button><button data-lg="en" class="' + (NLANG === 'en' ? 'on' : '') + '">英文原文</button></div>' : '';
    // 中文模式下把英文原文一起放在下面，不用切来切去也能对照
    const orig = hasZh(it) && NLANG === 'zh' ? '<div class="origbox"><div class="muted" style="font-size:12px;margin-bottom:6px">英文原文</div><b>' + esc(origTitle(it)) + '</b>' + (origIntro(it) ? '<p>' + esc(origIntro(it)) + '</p>' : '') + '</div>' : '';
    el.innerHTML = '<div class="dsheet" style="--kc:' + KC[it.type] + '"><div class="dt-head">' + posterHTML(it, 'dt-poster') + '<div><span class="kchip">' + KI[it.type] + ' ' + esc(it.type) + '</span><h2>' + esc(ttl) + '</h2>' +
      '<div class="muted">' + esc([it.creator, it.year, it.len].filter(Boolean).join(' · ')) + '</div>' + (it.meta ? '<div class="muted" style="margin-top:4px">' + esc(it.meta) + '</div>' : '') + (it.rating ? '<div style="margin-top:8px">' + rateHTML(it) + '</div>' : '') + '</div></div>' +
      langbar +
      (it.hook ? '<div class="sw-hook">' + (song ? '「' + esc(it.hook) + '」' : esc(it.hook)) + '</div>' : '') +
      (intro ? '<p>' + esc(intro) + '</p>' : '') + orig +
      '<div class="muted">' + it.tags.map(t => '#' + esc(t)).join(' ') + '</div>' +
      '<div class="dt-verb">' + VERB(it.type) + '<span>标了 App 的会直接打开 App</span></div><div class="jumps">' + linksOf(it).map(l => jump(l.platform, l.url, schemeOf(l.platform, l.url))).join('') + '</div>' +
      '<div class="btns" style="margin-top:16px"><button class="btn' + (s ? ' ghost' : '') + '" data-x="fav">' + (s ? '♥ 已在清单' : '♡ 加入清单') + '</button>' +
      (s ? '<button class="btn ghost" data-x="done">' + (s.done ? '✓ 已看过' : '标记看过') + '</button>' : '') + '</div></div>';
  };
  render();
  el.addEventListener('click', e => {
    const lg = e.target.closest('[data-lg]');
    if (lg) { NLANG = lg.dataset.lg; LS.set('newsLang', NLANG); render(); return; }
    const x = e.target.closest('[data-x]');
    if (x) {
      if (x.dataset.x === 'fav') toggleSaved(it);
      else { const v = saved(); v[it.id].done = !v[it.id].done; LS.set('saved', v); }
      render(); onChange && onChange(); return;
    }
    if (e.target === el) el.remove();
  });
  document.body.appendChild(el);
}

function openSearch() {
  const el = document.createElement('div'); el.className = 'sheet top';
  const tip = '<p class="muted">只记得一句歌词？直接打进来，比如「跨过山和大海」。也能搜歌名、歌手、片名、作者。</p>';
  el.innerHTML = '<div class="dsheet search"><div style="display:flex;gap:8px"><input id="sq" placeholder="歌词、歌名、歌手、片名…" autocomplete="off" enterkeyhint="search"><button class="btn ghost sm" data-close>取消</button></div><div id="sres">' + tip + '</div></div>';
  document.body.appendChild(el);
  const norm = s => String(s || '').toLowerCase().replace(/[\s，,。.!！?？·「」'’]/g, '');
  const inp = el.querySelector('#sq'); setTimeout(() => inp.focus(), 60);
  let res = [];
  inp.oninput = async () => {
    const k = norm(inp.value); if (LOADING) await LOADING; const lib = await getLib(null);
    res = k ? lib.filter(i => [i.title, i.title_zh, i.title_en, i.intro_zh, i.intro_en, i.creator, i.hook, i.tags.join(''), i.meta].some(x => norm(x).includes(k))).slice(0, 60) : [];
    el.querySelector('#sres').innerHTML = k ? (res.map((i, n) => rowHTML(i, n)).join('') || '<p class="muted">库里还没有。告诉小白这句歌词，下次补进来。</p>') : tip;
  };
  el.addEventListener('click', e => {
    if (e.target.closest('[data-close]') || e.target === el) { el.remove(); return; }
    const r = e.target.closest('[data-n]'); if (r) openDetail(res[+r.dataset.n]);
  });
}

async function viewDiscover() {
  document.body.classList.remove('bed');
  let lib = await getLib(KSEL);
  if (!KSEL && LOADING) LOADING.then(async () => { lib = await getLib(null); if (location.hash === '' || location.hash === '#/') { DECK = buildDeck(lib, DECK.slice(0, 3)); } });
  if (!DECK.length) DECK = buildDeck(lib);
  app.innerHTML = '<div class="disc"><div class="disc-head"><h1>刷一刷</h1><button class="icon" data-add aria-label="添加">＋</button><button class="icon" id="sbtn" aria-label="搜索">🔍</button></div>' +
    kindBar(KSEL) + '<div id="ssub">' + subBarHTML(lib) + '</div><div class="stack" id="stack"></div>' +
    '<div class="ctrl"><button class="rb big" data-a="no" aria-label="跳过">✕</button><button class="rb" data-a="undo" aria-label="撤销">↶</button><button class="rb" data-a="go" aria-label="打开">↗</button><button class="rb big like" data-a="yes" aria-label="想要">♥</button></div></div>';
  const stack = $('#stack');
  const render = () => {
    $('[data-a=undo]').style.opacity = HIST.length ? 1 : .35;
    if (!DECK.length) {
      stack.innerHTML = '<div class="empty"><div style="font-size:40px">✅</div><b>' + (KSEL ? '「' + KSEL + '」' : '全部') + '刷完了</b><span>新内容每天都会补进来</span><button class="btn ghost" id="reset">重刷跳过的</button></div>';
      $('#reset').onclick = () => { const s = swipes(); Object.keys(s).forEach(k => { if (!s[k].l && (!KSEL || s[k].t === KSEL)) delete s[k]; }); LS.set('swipes', s); DECK = buildDeck(lib); render(); };
      return;
    }
    stack.innerHTML = DECK.slice(0, 3).map(cardHTML).reverse().join('');
    const cs = [...stack.children].reverse();
    cs.forEach((c, i) => { c.style.transform = 'translateY(' + i * 12 + 'px) scale(' + (1 - i * 0.04) + ')'; });
    attach(cs[0]);
    $('[data-a=go]').textContent = '↗';
    songOnTop();
  };
  let busy = false;
  const commit = liked => {
    const it = DECK[0]; if (!it || busy) return; busy = true;
    const top = stack.lastElementChild;
    top.style.transition = 'transform .22s ease-out';
    top.style.transform = 'translate(' + (liked ? 600 : -600) + 'px,0) rotate(' + (liked ? 22 : -22) + 'deg)';
    navigator.vibrate && navigator.vibrate(8);
    setTimeout(() => {
      doSwipe(it, liked); HIST.push(it); if (HIST.length > 30) HIST.shift();
      DECK.shift(); if (DECK.length < 5) DECK = buildDeck(lib, DECK);
      busy = false; render(); if (liked) toast('♥ 已加入清单');
    }, 200);
  };
  function attach(el) {
    let sx = 0, sy = 0, dx = 0, dy = 0, down = false, moved = false;
    const lk = el.querySelector('.like'), np = el.querySelector('.nope');
    el.addEventListener('pointerdown', e => { down = true; moved = false; sx = e.clientX; sy = e.clientY; dx = dy = 0; el.setPointerCapture(e.pointerId); el.style.transition = 'none'; });
    el.addEventListener('pointermove', e => {
      if (!down) return; dx = e.clientX - sx; dy = e.clientY - sy; if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      el.style.transform = 'translate(' + dx + 'px,' + dy * 0.3 + 'px) rotate(' + dx / 18 + 'deg)';
      lk.style.opacity = Math.max(0, dx / 100); np.style.opacity = Math.max(0, -dx / 100);
    });
    const end = e => {
      if (!down) return; down = false;
      if (Math.abs(dx) > 100) { commit(dx > 0); return; }
      el.style.transition = 'transform .3s'; el.style.transform = ''; lk.style.opacity = 0; np.style.opacity = 0;
      if (moved) return;
      const md = el.querySelector('.sw-media'), r = md && md.getBoundingClientRect();
      if (DECK[0].type === '歌曲' && r && e.clientY >= r.top && e.clientY <= r.bottom) { toggleSong(); return; }
      openDetail(DECK[0]);
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  app.querySelector('.ctrl').onclick = e => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
    if (a === 'yes') commit(true); else if (a === 'no') commit(false);
    else if (a === 'undo') { const it = HIST.pop(); if (it) { undoSwipe(it); DECK.unshift(it); render(); } }
    else if (a === 'go' && DECK[0]?.links?.[0]) { const l = DECK[0].links[0]; openLink(l.url, schemeOf(l.platform, l.url)); }
  };
  app.querySelector('.kbar').onclick = e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    KSEL = b.dataset.k || null; app.querySelectorAll('.kbar button').forEach(x => x.classList.toggle('on', x === b));
    const want = KSEL;
    if (want && !LOADED[want]) {   // 这一类还没下载：先清掉旧卡、给出加载提示，别让人以为没切过去
      DECK = []; $('#ssub').innerHTML = ''; stopSong();
      stack.innerHTML = '<div class="empty"><div style="font-size:40px">' + (KI[want] || '⏳') + '</div><b>正在加载「' + want + '」…</b><span>第一次要下载' + (MAN?.types?.[want]?.count || '') + '条，稍等几秒</span></div>';
    }
    getLib(want).then(l => { if (KSEL !== want) return; lib = l; DECK = buildDeck(lib); $('#ssub').innerHTML = subBarHTML(lib); render(); });
  };
  $('#ssub').onclick = e => {
    const o = e.target.closest('[data-sgo]');
    if (o) { SOPEN = SOPEN === o.dataset.sgo ? null : o.dataset.sgo; const x = $('#ssub .sbar').scrollLeft; $('#ssub').innerHTML = subBarHTML(lib); $('#ssub .sbar').scrollLeft = x; return; }
    const b = e.target.closest('[data-sv]'), c = e.target.closest('[data-sclr]'); if (!b && !c) return;
    if (c) SSUB = {}; else SSUB[b.dataset.sg] = b.dataset.sv;
    SOPEN = null;
    LS.set('ssub', SSUB); const x = $('#ssub .sbar') ? $('#ssub .sbar').scrollLeft : 0;
    DECK = buildDeck(lib); $('#ssub').innerHTML = subBarHTML(lib); if ($('#ssub .sbar')) $('#ssub .sbar').scrollLeft = x; render();
    if (!DECK.length) toast('这个组合没有歌了，换一个试试');
  };
  $('#sbtn').onclick = openSearch;
  render();
}

async function viewShelf() {
  document.body.classList.remove('bed');
  const render = () => {
    const all = Object.values(saved()).sort((a, b) => b.ts - a.ts);
    const counts = {}; all.forEach(s => counts[s.item.type] = (counts[s.item.type] || 0) + 1);
    const list = all.filter(s => (!SK || s.item.type === SK) && !!s.done === SDONE);
    const tt = taste().filter(t => !KIND.includes(t.tag) && t.likes > 0).slice(0, 6);
    app.innerHTML = '<div class="wrap"><div class="shelf-head"><h1 class="title" style="margin:0">清单 <span class="cnt">' + all.length + '</span></h1><span><button class="icon" data-add aria-label="添加">＋</button><button class="icon" id="share" aria-label="分享">⤴︎</button><a class="icon" href="#/today" aria-label="故事">🎧</a><a class="icon" href="#/me" aria-label="设置">⚙︎</a></span></div>' +
      (tt.length ? '<div class="muted" style="margin:8px 0 6px">你最常右滑</div><div class="tchips">' + tt.map(t => '<span>#' + esc(t.tag) + ' ' + Math.round(t.rate * 100) + '%</span>').join('') + '</div>' : '') +
      kindBar(SK, counts) + '<div class="seg"><button class="' + (!SDONE ? 'on' : '') + '" data-d="0">想看</button><button class="' + (SDONE ? 'on' : '') + '" data-d="1">看过</button></div>' +
      '<div class="shelf">' + (list.map((s, n) => '<div class="srow">' + rowHTML(s.item, n, s.done) + '<button class="mini" data-t="' + n + '" aria-label="看过">' + (s.done ? '↺' : '✓') + '</button><button class="mini" data-r="' + n + '" aria-label="移除">✕</button></div>').join('') ||
        '<p class="muted">' + (all.length ? (SDONE ? '还没有标记看过的。' : '这一类没有待看的了。') : '去「刷」里右滑，喜欢的都会进到这里。') + '</p>') + '</div></div>';
    app.onclick = e => {
      const k = e.target.closest('.kbar [data-k]'), d = e.target.closest('[data-d]'), t = e.target.closest('[data-t]'), r = e.target.closest('[data-r]'), n = e.target.closest('[data-n]');
      if (k) { SK = k.dataset.k || null; render(); }
      else if (d) { SDONE = d.dataset.d === '1'; render(); }
      else if (t) { const v = saved(), id = list[+t.dataset.t].item.id; v[id].done = !v[id].done; LS.set('saved', v); render(); }
      else if (r) { const it = list[+r.dataset.r].item; toggleSaved(it); if (it.id[0] === 'u') { LS.set('mine', mine().filter(x => x.id !== it.id)); if (LIB) LIB = LIB.filter(x => x.id !== it.id); } render(); toast('已移出清单'); }
      else if (n) openDetail(list[+n.dataset.n].item, render);
      else if (e.target.closest('#share')) {
        let txt = '我的清单\n'; KIND.forEach(k => { const xs = all.filter(s => s.item.type === k); if (xs.length) txt += '\n【' + k + '】\n' + xs.map(s => '· ' + s.item.title + (s.item.creator ? ' — ' + s.item.creator : '') + (s.done ? ' ✓' : '')).join('\n') + '\n'; });
        if (navigator.share) navigator.share({ text: txt }).catch(() => { }); else navigator.clipboard?.writeText(txt).then(() => toast('已复制清单'));
      }
    };
  };
  render(); window.scrollTo(0, 0);
}

// ---------- 自选（存本机）：股票搜索 / 行情 / 相关新闻 ----------
const WATCH_DEF = [{ c: 'sh688981', n: '中芯国际' }, { c: 'usNVDA', n: '英伟达' }, { c: 'sz159995', n: '芯片ETF华夏' }];
const watch = () => LS.get('watch', WATCH_DEF);
const setWatch = w => LS.set('watch', w);
const wkey = c => 's_' + c;
const wname = n => n.replace(/(股份|集团|ETF.*|-W|-SW|\(.*\))$/g, '').slice(0, 4);
const aboutWatch = (n, ws) => { const t = dTitle(n) + ' ' + (dIntro(n) || '').slice(0, 120); return ws.find(w => { const k = wname(w.n); return k.length >= 2 && t.includes(k); }); };
async function searchStock(q) {
  // 接口不带 CORS 头，用 <script> 加载，结果在全局变量 v_hint
  const hint = await new Promise(res => {
    const s = document.createElement('script'); window.v_hint = undefined;
    s.src = 'https://smartbox.gtimg.cn/s3/?v=2&t=all&c=1&q=' + encodeURIComponent(q) + '&_=' + Date.now();
    s.onload = () => { res(window.v_hint || ''); s.remove(); }; s.onerror = () => { res(''); s.remove(); };
    document.head.appendChild(s); setTimeout(() => res(window.v_hint || ''), 5000);
  });
  if (!hint || hint === 'N') return [];
  return hint.split('^').map(s => s.split('~')).filter(f => f.length > 4 && (/^(GP|ETF|ZS|LOF|QDII)/.test(f[4]) || f[0] === 'us'))
    .map(f => ({ c: f[0] + (f[0] === 'us' ? f[1].split('.')[0].toUpperCase() : f[1]), n: f[2], m: ['sh', 'sz', 'bj'].includes(f[0]) ? 'A股' : f[0] === 'hk' ? '港股' : f[0] === 'us' ? '美股' : f[0] })).slice(0, 10);
}
function openWatchEdit(onChange) {
  const el = document.createElement('div'); el.className = 'sheet';
  const render = (res = []) => {
    const ws = watch();
    el.innerHTML = '<div class="dsheet"><h2 style="margin:4px 0 6px">我的自选</h2><p class="muted">搜代码或名字（A股/港股/美股/ETF），自选相关的新闻会排在要闻最前面。只存在这台设备。</p>' +
      '<input id="wq" placeholder="如 中芯、NVDA、半导体ETF" autocomplete="off" style="width:100%;padding:11px 14px;border-radius:12px;border:1px solid var(--line);background:var(--chip);font-size:15px;color:var(--ink)">' +
      '<div class="wres">' + res.map((x, i) => '<button data-wadd="' + i + '"><b>' + esc(x.n) + '</b><small>' + esc(x.m + ' · ' + x.c) + '</small><span>' + (ws.some(w => w.c === x.c) ? '已添加' : '＋') + '</span></button>').join('') + '</div>' +
      '<div class="muted" style="margin:14px 0 6px">已添加 ' + ws.length + '</div><div class="wlist">' + ws.map((w, i) => '<span>' + esc(w.n) + '<button data-del="' + i + '" aria-label="删除">✕</button></span>').join('') + '</div><button class="btn" data-ok style="margin-top:16px">好了</button></div>';
    const inp = el.querySelector('#wq'); let tm;
    inp.oninput = () => { clearTimeout(tm); tm = setTimeout(async () => { const q = inp.value.trim(); if (!q) return; try { const rr = await searchStock(q); const v = inp.value; render(rr); const ni = el.querySelector('#wq'); ni.value = v; ni.focus(); } catch { } }, 300); };
    el._res = res;
  };
  render();
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-wadd]'); if (a) { e.stopPropagation(); const x = el._res[+a.dataset.wadd], ws = watch(); if (!ws.some(w => w.c === x.c)) { ws.push({ c: x.c, n: x.n }); setWatch(ws); } render(el._res); return; }
    const d = e.target.closest('[data-del]'); if (d) { const ws = watch(); ws.splice(+d.dataset.del, 1); setWatch(ws); render(el._res); return; }
    if (e.target === el || e.target.closest('[data-ok]')) { el.remove(); onChange && onChange(); }
  });
  document.body.appendChild(el); setTimeout(() => el.querySelector('#wq').focus(), 80);
}
// ---------- 已读 ----------
const readSet = () => LS.get('read', {});
function markRead(id) { const r = readSet(); r[id] = Date.now(); const ks = Object.keys(r); if (ks.length > 1500) ks.sort((a, b) => r[a] - r[b]).slice(0, ks.length - 1500).forEach(k => delete r[k]); LS.set('read', r); }
// 顶部「此刻要点」：最近 12 小时多源/大新闻/自选相关里挑 5 条
function briefHTML(all) {
  const now = Date.now() / 1000, ws = watch(), rd = readSet(), sw = swipes(), I = interest();
  const pool = all.filter(n => n.type === '新闻' && now - (n.t || 0) < 12 * 3600 && !(sw[n.id] && !sw[n.id].l) && !muted(n, I) && !(n.tags || []).includes('公告'));
  const sc = n => ((n.tags || []).includes('大新闻') ? 3 : 0) + (n.also || []).length * 1.5 + (aboutWatch(n, ws) ? 2.5 : 0) + ((n.tags || []).some(t => I[t] > 0) ? 1 : 0) - (now - n.t) / 3600 / 6;
  const top = pool.map(n => [sc(n), n]).sort((a, b) => b[0] - a[0]).slice(0, 5).map(x => x[1]);
  if (top.length < 3) return '';
  const h = new Date().getHours(), tl = h < 11 ? '早报' : h < 14 ? '午间要点' : h < 19 ? '午后要点' : '晚间要点';
  return '<div class="brief"><div class="bf-h"><b>📌 ' + tl + '</b><span class="muted">' + top.filter(n => !rd[n.id]).length + ' 条未读 · 按重要度</span></div>' + top.map((n, i) => '<div class="bf-r' + (rd[n.id] ? ' rd' : '') + '" data-bf="' + n.id + '"><i>' + (i + 1) + '</i><span>' + esc(dTitle(n)) + ((n.also || []).length ? ' <em>' + (n.also.length + 1) + '家</em>' : '') + '</span></div>').join('') + '</div>';
}

// ---------- 学点：碎片时间学点东西（每天 3 条 + 8 个主题，进度/打卡存本机） ----------
let LEARN = null, LTOPIC = null;
const learnDone = () => LS.get('learnDone', {});
function learnStreak() { const d = learnDone(), days = new Set(Object.values(d).map(x => x.day)); let n = 0; for (let i = 0; i < 400; i++) { const k = new Date(Date.now() - i * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10); if (days.has(k)) n++; else if (i > 0) break; } return n; }
const todayKey = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
function markLearn(it) { const d = learnDone(); if (d[it.id]) delete d[it.id]; else d[it.id] = { day: todayKey(), ts: Date.now(), topic: it.topic, secs: it.secs || 0 }; LS.set('learnDone', d); }
const lstars = n => '★'.repeat(n) + '<span style="opacity:.25">' + '★'.repeat(3 - n) + '</span>';
function lcard(it, slot, big) {
  const done = !!learnDone()[it.id];
  return '<div class="lcard' + (big ? ' big' : '') + (done ? ' done' : '') + '" data-lid="' + it.id + '">' +
    '<div class="lc-img">' + (it.poster ? '<img src="' + esc(it.poster) + '" referrerpolicy="no-referrer" loading="lazy" alt="" onerror="this.remove()">' : '') + '<span class="dur">' + esc(it.len) + '</span>' + (slot ? '<span class="slot">' + esc(slot) + '</span>' : '') + (done ? '<span class="ok">✓ 学过</span>' : '') + '<button class="lx" data-lno="' + it.id + '" aria-label="不感兴趣">✕</button></div>' +
    '<div class="lc-tx"><b>' + esc(it.title) + '</b><small>' + esc(it.creator) + ' · ' + esc(it.tags[1] || '') + '</small><small class="lc-m"><span class="st">' + lstars(it.stars || 1) + '</span> ' + esc(it.meta || '') + '</small></div>' +
    '<div class="lc-act">' + (it.audio ? '<button class="btn sm" data-lplay="' + it.id + '">▶ 直接听</button>' : '<button class="btn sm" data-lgo="' + it.id + '">▶ 去 B 站看</button>') + '<button class="btn ghost sm" data-ldone="' + it.id + '">' + (done ? '取消打卡' : it.audio ? '✓ 听完了' : '✓ 看完了') + '</button><button class="btn ghost sm" data-lsave="' + it.id + '">' + (saved()[it.id] ? '♥ 已存' : '♡ 稍后看') + '</button></div></div>';
}
async function viewLearn() {
  document.body.classList.remove('bed');
  if (!LEARN) { try { LEARN = await (await fetch('data/learn.json', { cache: 'no-cache' })).json(); } catch { LEARN = { topics: [], today: [] }; } }
  const all = {}; LEARN.topics.forEach(t => [...t.items, ...(t.pods || [])].forEach(x => all[x.id] = x));
  const render = () => {
    const d = learnDone(), dv = Object.values(d), wk = dv.filter(x => Date.now() - x.ts < 7 * 864e5), mins = Math.round(wk.reduce((a, x) => a + (x.secs || 0), 0) / 60);
    const sk = learnStreak(), today = (LEARN.today || []).filter(p => all[p.id]);
    const tdone = today.filter(p => d[p.id]).length;
    let h = '<div class="wrap"><div class="shelf-head"><h1 class="title" style="margin:0;font-family:var(--sans);font-weight:800">学点 <span class="muted" style="font-size:13px;font-weight:400">碎片时间 · 只挑短而干的</span></h1></div>' +
      '<div class="lstat"><div><b>' + sk + '</b><small>连续天数</small></div><div><b>' + wk.length + '</b><small>本周看完</small></div><div><b>' + mins + '</b><small>本周分钟</small></div><div><b>' + tdone + '/' + today.length + '</b><small>今日</small></div></div>';
    if (!LTOPIC) {
      const sw0 = swipes();
      h += '<div class="lsec">今天的 ' + today.length + ' 个 <span class="muted">按时长挑好，看完点 ✓</span></div>' + today.filter(p => !(sw0[p.id] && !sw0[p.id].l)).map(p => lcard(all[p.id], p.slot, true)).join('') +
        '<div class="lsec">按主题刷 <span class="muted">每个主题按「收藏率」排，越靠前越值得存</span></div><div class="ltopics">' +
        LEARN.topics.map(t => { const n = t.items.filter(x => d[x.id]).length + (t.pods || []).filter(x => d[x.id]).length; return '<button data-lt="' + t.id + '"><span class="ic">' + t.icon + '</span><b>' + esc(t.name) + '</b><small>' + esc(t.sub) + '</small><i>' + n + ' / ' + t.items.length + '</i><span class="bar"><span style="width:' + Math.round(n / Math.max(1, t.items.length) * 100) + '%"></span></span></button>'; }).join('') + '</div>' +
        '<p class="muted" style="font-size:12px;margin-top:18px">视频来自 B 站公开搜索，按播放、收藏率、点赞率自动挑；每天早上换 3 条，不重复。不感兴趣的点卡片右上角 ✕。</p>';
    } else {
      const t = LEARN.topics.find(x => x.id === LTOPIC), sw = swipes();
      const items = t.items.filter(x => !(sw[x.id] && !sw[x.id].l));
      const pods = (t.pods || []).filter(x => !(sw[x.id] && !sw[x.id].l));
      if (LEARN._kind === 'pod') { h += '<button class="linkbtn" data-lback style="margin:4px 0 10px;font-size:15px">‹ 全部主题</button><div class="lsec">' + t.icon + ' ' + esc(t.name) + '</div><div class="lseg"><button data-lk="vid">📺 视频 ' + items.length + '</button><button data-lk="pod" class="on">🎧 播客 ' + pods.length + '</button></div>' + (pods.map(x => lcard(x, '', false)).join('') || '<p class="muted">这个主题暂时没有新的播客单集</p>'); app.innerHTML = h + '</div>'; return; }
      h += '<div class="lseg" style="margin-top:4px"><button data-lk="vid" class="on">📺 视频 ' + items.length + '</button><button data-lk="pod">🎧 播客 ' + pods.length + '</button></div>';
      h += '<button class="linkbtn" data-lback style="margin:4px 0 10px;font-size:15px">‹ 全部主题</button><div class="lsec">' + t.icon + ' ' + esc(t.name) + ' <span class="muted">' + esc(t.sub) + '</span></div>' +
        '<div class="lseg"><button data-ld="0" class="' + (!LEARN._dur ? 'on' : '') + '">全部</button><button data-ld="1" class="' + (LEARN._dur === 1 ? 'on' : '') + '">5 分钟内</button><button data-ld="2" class="' + (LEARN._dur === 2 ? 'on' : '') + '">15 分钟内</button><button data-ld="3" class="' + (LEARN._dur === 3 ? 'on' : '') + '">更长</button></div>' +
        items.filter(x => !LEARN._dur || (LEARN._dur === 1 ? x.secs <= 300 : LEARN._dur === 2 ? x.secs <= 900 : x.secs > 900)).map(x => lcard(x, '', false)).join('');
    }
    app.innerHTML = h + '</div>';
  };
  app.onclick = e => {
    const lt = e.target.closest('[data-lt]'); if (lt) { LTOPIC = lt.dataset.lt; LEARN._dur = 0; LEARN._kind = 'vid'; render(); window.scrollTo(0, 0); return; }
    if (e.target.closest('[data-lback]')) { LTOPIC = null; render(); window.scrollTo(0, 0); return; }
    const lk = e.target.closest('[data-lk]'); if (lk) { LEARN._kind = lk.dataset.lk; render(); return; }
    const lp = e.target.closest('[data-lplay]'); if (lp) { const it = all[lp.dataset.lplay]; noteOpen(it); markRead(it.id); play([{ src: it.audio, title: it.title, kind: 'pod' }], { column: it.creator, title: it.creator }); toast('🎧 开始播放，可后台听'); return; }
    const ld = e.target.closest('[data-ld]'); if (ld) { LEARN._dur = +ld.dataset.ld; render(); return; }
    const g = e.target.closest('[data-lgo]'); if (g) { const it = all[g.dataset.lgo]; noteOpen(it); markRead(it.id); const l = it.links[0]; const sc = schemeOf(l.platform, l.url); if (sc) { const t0 = Date.now(); location.href = sc; setTimeout(() => { if (!document.hidden && Date.now() - t0 < 2500) window.open(l.url, '_blank'); }, 1200); } else window.open(l.url, '_blank'); return; }
    const dn = e.target.closest('[data-ldone]'); if (dn) { const it = all[dn.dataset.ldone], was = !!learnDone()[it.id]; markLearn(it); if (!was) { doSwipe(it, true); const v = saved(); if (v[it.id]) { v[it.id].done = true; LS.set('saved', v); } toast('✓ 打卡，连续 ' + learnStreak() + ' 天'); } const y = window.scrollY; render(); window.scrollTo(0, y); return; }
    const no = e.target.closest('[data-lno]'); if (no) { doSwipe(all[no.dataset.lno], false); const card = no.closest('.lcard'); card.style.transition = 'opacity .2s'; card.style.opacity = 0; setTimeout(() => { const y = window.scrollY; render(); window.scrollTo(0, y); }, 200); toast('不再推这条'); return; }
    const sv = e.target.closest('[data-lsave]'); if (sv) { toggleSaved(all[sv.dataset.lsave]); const y = window.scrollY; render(); window.scrollTo(0, y); toast(saved()[sv.dataset.lsave] ? '♥ 已放进清单' : '已移出清单'); return; }
    const c = e.target.closest('[data-lid]'); if (c && !e.target.closest('button')) openDetail(all[c.dataset.lid]);
  };
  render(); window.scrollTo(0, 0);
}
// ---------- 要闻 ----------

// ---------- 即时快讯：直接从华尔街见闻 / 东方财富拉（两家接口都放行跨域），不等云端 ----------
const FLASH_SRC = ['华尔街见闻', '东方财富', '新浪财经'];
const HARDW = /台独|藏独|疆独|法轮|六四|天安门事件|色情|赌博|自杀/;
let LIVE = [], LIVE_AT = 0, LIVET = null;
const stripH = s => (s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const splitT = c => { let m = /^【(.{4,70}?)】/.exec(c); if (m) return [m[1], c.slice(m[0].length).trim()]; m = /^(.{8,60}?)[。；]/.exec(c); return m ? [m[1], c] : [c.slice(0, 56), c]; };
async function fetchLive() {
  const j = async u => (await fetch(u, { cache: 'no-store' })).json(), out = [];
  const [a, b] = await Promise.allSettled([
    j('https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=60'),
    j('https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=60&req_trace=' + Date.now())]);
  if (a.status === 'fulfilled') for (const r of ((a.value.data || {}).items || [])) {
    const c = stripH(r.content_text || r.content); if (c.length < 10 || HARDW.test(c)) continue;
    const [t, body] = splitT((r.title ? '【' + r.title + '】' : '') + c);
    out.push({ id: 'lw' + r.id, type: '新闻', title: t, intro: body !== t ? body : '', creator: '华尔街见闻', t: +r.display_time, tags: ['财经', '即时', ...((r.score || 1) >= 2 ? ['大新闻'] : [])], links: [{ platform: '原文', url: r.uri || 'https://wallstreetcn.com/live/global' }], poster: '' });
  }
  if (b.status === 'fulfilled') for (const r of (((b.value.data || {}).fastNewsList) || [])) {
    const t = stripH(r.title); if (!t || HARDW.test(t)) continue;
    out.push({ id: 'le' + r.code, type: '新闻', title: t, intro: stripH(r.summary).replace(/^【.*?】/, ''), creator: '东方财富', t: Date.parse((r.showTime || '').replace(' ', 'T') + '+08:00') / 1000 || 0, tags: ['财经', '即时', ...(r.titleColor == 3 ? ['大新闻'] : [])], links: [{ platform: '原文', url: 'https://finance.eastmoney.com/a/' + r.code + '.html' }], poster: '' });
  }
  if (out.length) { LIVE = out; LIVE_AT = Date.now(); }
  return out.length;
}
function flashList(all) {
  const sw = swipes(), seen = new Set(), now = Date.now() / 1000;
  return [...LIVE, ...all.filter(n => n.type === '新闻' && FLASH_SRC.includes(n.creator))].sort((a, b) => (b.t || 0) - (a.t || 0))
    .filter(n => { const k = (n.title || '').replace(/\W/g, '').slice(0, 18); if (seen.has(k) || now - (n.t || 0) > 86400 || (sw[n.id] && !sw[n.id].l)) return false; seen.add(k); return true; }).slice(0, 200);
}
const fhm = t => { const d = new Date(t * 1000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const frow = (n, i) => '<div class="frow' + (readSet()[n.id] ? ' rd' : '') + (n.tags.includes('大新闻') ? ' hot' : '') + '" data-i="' + i + '"><time>' + fhm(n.t) + '</time><div><b>' + esc(n.title) + '</b>' + (n.intro ? '<p>' + esc(n.intro) + '</p>' : '') + '<small>' + esc(n.creator) + '</small></div></div>';
// 精选：质量分 q 为主，每过一天约扣 1 分
const pickScore = n => (n.q || 5) - (Date.now() / 1000 - (n.t || 0)) / 86400;
const PKC = { '论文': '#7c5cff', '热议': '#ff7a45', '深度': '#2b8a6e' };
const pkBadge = n => { if (!(n.tags || []).includes('精选')) return ''; const k = n.tags[1]; return '<i class="pk" style="background:' + (PKC[k] || '#6c8cff') + '">' + esc(k) + '</i>'; };
const NCH = ['精选', '即时', '推荐', '关注', '大新闻', '科技', 'X', '政策', '股票', '自选', '热搜', '全部'];
const inCh = (n, c) => c === '全部' ? true : c === '自选' ? !!aboutWatch(n, watch()) : c === '热搜' ? n.creator === '微博热搜' : c === 'X' ? n.type === 'X' : c === '科技' ? tagsOf(n).some(t => ['科技', 'AI', '数码', '创业', '半导体', '机器人'].includes(t)) : tagsOf(n).includes(c);
let NCUR = '精选';
const nrow = (n, i, why) => '<div class="nrow' + (readSet()[n.id] ? ' rd' : '') + '" data-i="' + i + '"><div style="flex:1;min-width:0"><b>' + (n.tags.includes('大新闻') ? '<i class="big">要</i>' : '') + pkBadge(n) + zhTag(n) + esc(dTitle(n)) + '</b>' + (dIntro(n) ? '<p>' + esc(dIntro(n)) + '</p>' : '') + '<small><em>' + esc(n.creator) + '</em>' + ((n.also || []).length ? '<span class="also">+' + n.also.length + ' 家报道</span> ' : '') + (n.t ? ago(n.t) : '') + (why ? ' · <span class="why">' + esc(why) + '</span>' : '') + '</small></div>' + (n.poster ? '<img src="' + esc(n.poster) + '" referrerpolicy="no-referrer" loading="lazy" alt="" onerror="this.remove()">' : '') + '<button class="nx" data-no="' + i + '" aria-label="不感兴趣">✕</button></div>';
async function viewNews() {
  document.body.classList.remove('bed');
  await getLib('新闻');
  const all = (LOADED['新闻'] || []).slice().sort((a, b) => (b.t || 0) - (a.t || 0));
  let list = [];
  const pick = () => { const sw = swipes(), I = interest();
    if (NCUR === '精选') { list = all.filter(n => (n.tags || []).includes('精选') && !(sw[n.id] && !sw[n.id].l) && !muted(n, I)).sort((a, b) => pickScore(b) - pickScore(a)); return; }
    if (NCUR === '即时') { list = flashList(all); return; }
    list = NCUR === '推荐' ? rankNews(all) : all.filter(n => inCh(n, NCUR) && !(sw[n.id] && !sw[n.id].l) && (NCUR === '全部' || !muted(n, I))); };
  const render = () => {
    const I = interest(), M = learned();
    app.innerHTML = '<div class="wrap"><div class="shelf-head"><h1 class="title" style="margin:0;font-family:var(--sans);font-weight:800">要闻 <span class="muted" style="font-size:13px;font-weight:400">' + (NEWS_AT ? ago(NEWS_AT) + '更新' : '') + '</span></h1><div style="display:flex;gap:8px;align-items:center">' + langBtn() + '<a class="icon" href="#/quiz" aria-label="猜涨跌">🎲</a><a class="icon" href="#/moves" aria-label="异动">📈</a><button class="icon" data-watch aria-label="自选">⭐</button><button class="icon" data-intr aria-label="兴趣">🎯</button></div></div>' + (NCUR === '推荐' ? briefHTML(all) : '') +
      '<div class="srcbar">' + NCH.map(c => '<button data-s="' + c + '" class="' + (NCUR === c ? 'on' : '') + '">' + c + '</button>').join('') + '</div>' +
      (NCUR === '即时' ? '<div class="livebar"><i class="dot"></i><span>实时快讯 · 每 60 秒自动刷新' + (LIVE_AT ? ' · ' + new Date(LIVE_AT).toTimeString().slice(0, 5) + ' 拉取' : ' · 连接中…') + '</span><button class="linkbtn" data-lr>刷新</button></div><div class="flist">' + list.map(frow).join('') + '</div></div>' :
      NCUR === '精选' ? '<p class="muted pkhint">只收值得花时间的：社区高赞 AI 论文、Hacker News 热议、AI 实验室与研究者长文。英文已自动翻译，点开看原文。</p><div class="news-list">' + (list.map((n, i) => nrow(n, i, '')).join('') || '<p class="muted">精选还在路上，稍后下拉刷新。</p>') + '</div></div>' :
      '<div class="news-list">' + (list.map((n, i) => nrow(n, i, NCUR === '推荐' ? whyOf(n, I, M) : '')).join('') || '<p class="muted">这里暂时没有新内容。</p>') + '</div></div>');
  };
  app.onclick = e => {
    if (e.target.closest('[data-lang]')) { toggleLang(); render(); return; }
    const s = e.target.closest('[data-s]'); if (s) { NCUR = s.dataset.s; pick(); render(); window.scrollTo(0, 0); live(); return; }
    if (e.target.closest('[data-lr]')) { toast('刷新中…'); fetchLive().then(n => { if (NCUR === '即时') { pick(); render(); toast(n ? '已更新' : '快讯源暂时连不上'); } }); return; }
    if (e.target.closest('[data-intr]')) return openInterest(() => { pick(); render(); });
    if (e.target.closest('[data-watch]')) return openWatchEdit(() => { pick(); render(); });
    const bf = e.target.closest('[data-bf]'); if (bf) { const it = all.find(x => x.id === bf.dataset.bf); if (it) { openDetail(it); bf.classList.add('rd'); } return; }
    const x = e.target.closest('[data-no]'); if (x) { const it = list[+x.dataset.no]; doSwipe(it, false); list = list.filter(v => v.id !== it.id); const y = window.scrollY; render(); window.scrollTo(0, y); toast('会少推这类'); return; }
    const r = e.target.closest('[data-i]'); if (r) { openDetail(list[+r.dataset.i]); r.classList.add('rd'); }
  };
  // 即时频道：进来先拉一次，之后每 60 秒拉一次（切走或离开页面就停）
  const live = () => {
    clearInterval(LIVET); if (NCUR !== '即时') return;
    const go = () => { if (document.hidden || NCUR !== '即时' || !document.querySelector('.flist')) return; fetchLive().then(() => { if (NCUR === '即时' && document.querySelector('.flist')) { const y = window.scrollY; pick(); render(); window.scrollTo(0, y); } }); };
    go(); LIVET = setInterval(() => { if (!document.querySelector('.livebar')) { clearInterval(LIVET); return; } go(); }, 60000);
  };
  pick(); render(); window.scrollTo(0, 0); live();
}
function openInterest(onChange) {
  const el = document.createElement('div'); el.className = 'sheet';
  const render = () => {
    const I = interest(), M = learned(), ext = Object.keys(LS.get('interest', {})).filter(t => !INTR_TAGS.includes(t));
    const top = Object.keys(M).filter(t => M[t] > 0.12 && !KIND.includes(t)).sort((a, b) => M[b] - M[a]).slice(0, 6), low = Object.keys(M).filter(t => M[t] < -0.2 && !KIND.includes(t)).sort((a, b) => M[a] - M[b]).slice(0, 6);
    el.innerHTML = '<div class="dsheet"><h2 style="margin:4px 0 6px">我的兴趣</h2><p class="muted">点一下切换：正常 → 多推 → 少推 → 不看。你左右滑、点开、点 ✕ 也会自动调整。数据只存在这台手机。</p><div class="ichips">' +
      [...INTR_TAGS, ...ext].map(t => { const v = I[t] || 0; return '<button data-t="' + esc(t) + '" class="lv' + (v > 0 ? 'u' : v <= -3 ? 'x' : v < 0 ? 'd' : '') + '">' + esc(t) + '<small>' + LV[v] + '</small></button>'; }).join('') + '</div>' +
      (top.length ? '<p class="muted">学到你喜欢：' + top.map(esc).join('、') + '</p>' : '') + (low.length ? '<p class="muted">学到你不太看：' + low.map(esc).join('、') + '</p>' : '') + '<button class="btn" data-ok>好了</button></div>';
  };
  render();
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-t]');
    if (t) { const v = interest()[t.dataset.t] || 0; setInterest(t.dataset.t, v === 0 ? 2 : v > 0 ? -1 : v > -3 ? -3 : 0); const sc = el.firstChild.scrollTop; render(); el.firstChild.scrollTop = sc; return; }
    if (e.target === el || e.target.closest('[data-ok]')) { el.remove(); onChange && onChange(); }
  });
  document.body.appendChild(el);
}
// ---------- 股市：我的股市 APP 结论卡 + 分时/日K 曲线 + 报价 + 消息 ----------
const MKBASE = 'https://1742483876.github.io/market-indicator-academy/';
const MKAPP = 'xqty://open?u=%23%2Ftodo';
const QS = [['A股', ['s_sh000001', 's_sz399001', 's_sz399006', 's_sh000688', 's_sh000300']], ['港股', ['s_hkHSI', 's_hkHSTECH']], ['美股', ['s_usDJI', 's_usIXIC', 's_usINX', 's_usNDX']], ['商品', ['hf_GC', 'hf_CL']]];
// [显示名, 报价 key, 曲线代码]
const CHSYM = [['上证', 's_sh000001', 'sh000001'], ['深成', 's_sz399001', 'sz399001'], ['创业板', 's_sz399006', 'sz399006'], ['沪深300', 's_sh000300', 'sh000300'], ['恒生', 's_hkHSI', 'hkHSI'], ['恒生科技', 's_hkHSTECH', 'hkHSTECH'], ['纳指', 's_usIXIC', 'usIXIC'], ['道指', 's_usDJI', 'usDJI']];
let CHCUR = 0, CHMODE = 'minute', CHSEQ = 0, QT = null, LASTQ = {};
async function quotes() {
  const r = await fetch('https://qt.gtimg.cn/q=' + QS.flatMap(g => g[1]).join(',') + '&_=' + Date.now(), { cache: 'no-store' });
  const txt = new TextDecoder('gbk').decode(await r.arrayBuffer()), o = {};
  for (const m of txt.matchAll(/v_(\w+)="([^"]*)"/g)) {
    if (m[1].startsWith('hf_')) { const f = m[2].split(','); o[m[1]] = { n: f[13], p: +f[0], c: +f[1] }; }
    else { const f = m[2].split('~'); o[m[1]] = { n: f[1], p: +f[3], c: +f[5] }; }
  }
  return o;
}
// ---- 曲线数据：腾讯分时 / 前复权日K（ifzq 域名带 CORS，web.ifzq 的日K会被 WAF 拦） ----
async function chartFetch(sym, mode) {
  if (mode === 'minute') {
    const j = await (await fetch('https://ifzq.gtimg.cn/appstock/app/minute/query?code=' + sym + '&_=' + Date.now(), { cache: 'no-store' })).json();
    const d = (j.data || {})[sym] || {}, raw = ((d.data || {}).data || []);
    const rows = raw.map(s => { const p = String(s).trim().split(/\s+/); return { t: p[0], v: +p[1] }; }).filter(x => isFinite(x.v) && x.v > 0);
    return { kind: 'minute', rows, date: (d.data || {}).date || '' };
  }
  const j = await (await fetch('https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + sym + ',day,,,40,qfq&_=' + Date.now(), { cache: 'no-store' })).json();
  const d = (j.data || {})[sym] || {}, raw = d.qfqday || d.day || [];
  const rows = raw.map(a => ({ t: a[0], o: +a[1], c: +a[2], h: +a[3], l: +a[4] })).filter(x => isFinite(x.c) && x.c > 0);
  return { kind: 'day', rows };
}
const hhmm = t => /^\d{4}$/.test(t || '') ? t.slice(0, 2) + ':' + t.slice(2) : (t || '');
function chartSVG(d, base) {
  const W = 320, H = 118, P = 4, rows = d.rows;
  if (d.kind === 'minute') {
    const vals = rows.map(x => x.v), last = vals[vals.length - 1];
    const prev = base > 0 ? base : vals[0];
    let rng = Math.max(Math.max(...vals) - prev, prev - Math.min(...vals), prev * 0.0015);
    const lo = prev - rng * 1.12, hi = prev + rng * 1.12;
    const X = i => P + i / Math.max(1, vals.length - 1) * (W - 2 * P);
    const Y = v => P + (hi - v) / (hi - lo) * (H - 2 * P);
    const line = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
    const area = line + ' L' + X(vals.length - 1).toFixed(1) + ',' + H + ' L' + P + ',' + H + ' Z';
    const cv = last >= prev ? 'up' : 'down';   // 红涨绿跌；走主题变量，深/浅/护眼模式都达标
    const yb = Y(prev).toFixed(1);
    const xlab = '<div class="chart-x"><span>' + hhmm(rows[0].t) + '</span><span>' + hhmm(rows[Math.floor(rows.length / 2)].t) + '</span><span>' + hhmm(rows[rows.length - 1].t) + '</span></div>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chsvg" preserveAspectRatio="none">' +
      '<path d="' + area + '" style="fill:var(--' + cv + ');opacity:.12"/><line x1="0" y1="' + yb + '" x2="' + W + '" y2="' + yb + '" stroke="currentColor" stroke-opacity=".22" stroke-dasharray="3 4" stroke-width="1"/>' +
      '<path d="' + line + '" style="fill:none;stroke:var(--' + cv + ')" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>' + xlab;
  }
  const lo = Math.min(...rows.map(x => x.l)), hi = Math.max(...rows.map(x => x.h)), span = hi - lo || 1;
  const Y = v => P + (hi - v) / span * (H - 2 * P), step = W / rows.length, bw = Math.max(1.5, step * 0.58);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chsvg" preserveAspectRatio="none">';
  rows.forEach((r, i) => {
    const x = P + i * step + (step - bw) / 2, cv = r.c >= r.o ? 'up' : 'down';
    const yo = Y(r.o), yc = Y(r.c), top = Math.min(yo, yc), h = Math.max(1, Math.abs(yo - yc));
    s += '<line x1="' + (x + bw / 2).toFixed(1) + '" y1="' + Y(r.h).toFixed(1) + '" x2="' + (x + bw / 2).toFixed(1) + '" y2="' + Y(r.l).toFixed(1) + '" style="stroke:var(--' + cv + ')" stroke-width="1"/>' +
      '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" style="fill:var(--' + cv + ')"/>';
  });
  s += '</svg><div class="chart-x"><span>' + rows[0].t.slice(5) + '</span><span>近 ' + rows.length + ' 个交易日 · 前复权</span><span>' + rows[rows.length - 1].t.slice(5) + '</span></div>';
  return s;
}
async function renderChart() {
  const box = $('#chart'); if (!box) return;
  const c = CHSYM[CHCUR], seq = ++CHSEQ;
  box.innerHTML = '<div class="skl tall"></div><div class="skl w3"></div>';
  const q = LASTQ[c[1]], base = q && q.p && q.c > -100 ? q.p / (1 + q.c / 100) : 0;
  try {
    let d = await chartFetch(c[2], CHMODE);
    if (d.rows.length < 5 && CHMODE === 'minute') d = await chartFetch(c[2], 'day');   // 美股刚开盘等只有 1 个点，自动给日K
    if (seq !== CHSEQ) return;
    if (d.rows.length < 2) throw new Error('empty');
    box.innerHTML = chartSVG(d, base) + (d.kind === 'day' && CHMODE === 'minute' ? '<div class="muted" style="font-size:11px">该市场暂时没有分时数据，已自动显示日K</div>' : '');
  } catch {
    if (seq === CHSEQ) box.innerHTML = '<div class="stbar fail"><i></i><span><b>这段曲线没拉到</b> · 行情接口暂时不可用，也可以换个指数</span><button data-chretry>重试</button></div>';
  }
}
// ---- 我的股市 APP（红了么）线上公开 JSON ----
const mkLevel = v => v === 'buy' || v === 'yes' ? 'buy' : v === 'no' ? 'no' : 'wait';
// 结论数据时点超过 20 小时就明确说「不是最新」，避免把盘后结论误读成实时信号
function mkStale(at) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(at || '');
  if (!m) return '';
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  return (Date.now() - t) / 3600000 > 20 ? '数据来自 ' + at : '';
}
async function renderMarketApp() {
  const box = $('#mkapp'); if (!box) return;
  box.innerHTML = '<div class="mkcard"><div class="skl w1"></div><div class="skl tall"></div><div class="skl w2"></div><div class="skl w3"></div></div>';
  try {
    const [todo, pick, trend, ev] = await Promise.all(['todo', 'pick', 'trend', 'events'].map(f =>
      fetch(MKBASE + f + '.json?_=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).catch(() => null)));
    if (!todo) throw new Error('offline');
    const cn = (todo.pos && todo.pos.cn) || {}, us = (todo.pos && todo.pos.us) || {};
    const lvl = mkLevel(cn.level), word = cn.word || '等待确认';
    const p = (pick && pick.pick && pick.pick.main) || null;
    const t = trend || {};
    const today = new Date().toISOString().slice(0, 10);
    const evs = ((ev && ev.events) || []).filter(x => x.date >= today).slice(0, 3);
    const at = cn.at || todo.built || '', stale = mkStale(at);
    const atShort = /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(5, 16) : at;   // 顶部放短时点，完整值在 title / 过期提示里
    const missing = [!pick && '今日一票', !trend && '趋势', !ev && '财经日历'].filter(Boolean);
    box.innerHTML = '<div class="mkcard"><div class="mk-top"><span>📱 我的股市 APP · 红了么</span><span title="' + esc(at) + '">数据时点 ' + esc(atShort || '—') + '</span></div>' +
      '<div class="mk-verdict ' + lvl + '"><b>' + esc(word) + '</b><span>A股 · 仓位上限 ' + (cn.cap ?? '—') + '%</span></div>' +
      '<div class="mk-head">' + esc(todo.headline || '') + '</div>' +
      (cn.reason ? '<div class="mk-why">一句原因：' + esc(cn.reason) + '</div>' : '') +
      (stale ? '<div class="stbar warn"><i></i><span><b>不是最新盘后结论</b> · ' + esc(stale) + '，别当实时信号</span></div>' : '') +
      '<div class="mk-rows">' +
        (us.word ? '<div><span>美股</span><b>' + esc(us.word) + '</b><em>上限 ' + (us.cap ?? '—') + '%</em></div>' : '') +
        (t.name ? '<div><span>趋势</span><b>' + esc(t.state || '') + ' ' + esc(t.name) + '</b><em>' + esc(t.dir || '') + ' · ' + esc(t.conf || '') + '</em></div>' : '') +
        (p ? '<div><span>今日一票</span><b>' + esc(p.name) + '</b><em>' + esc(p.sig_txt || '') + '</em></div>' : '') +
      '</div>' +
      (t.op ? '<div class="mk-op">' + esc(t.op) + '</div>' : '') +
      (evs.length ? '<div class="mk-ev"><span class="muted">接下来大事</span>' + evs.map(x => '<div>· ' + esc(x.date.slice(5)) + ' ' + esc(x.title || x.short || '') + '</div>').join('') + '</div>' : '') +
      (missing.length ? '<div class="stbar"><i></i><span>部分数据没取到：' + esc(missing.join('、')) + '；上方结论不受影响</span><button data-mkretry>重试</button></div>' : '') +
      '<div class="mk-btns"><button class="btn sm" data-mkgo>在「红了么」里打开</button><a class="btn ghost sm" href="' + MKBASE + '#/todo" target="_blank" rel="noopener">网页版完整内容</a></div>' +
      '<div class="muted" style="font-size:11px;margin-top:8px">结论与数据时点来自你自己那份股市 APP 的公开数据，未改动其判断。</div></div>';
  } catch {
    box.innerHTML = '<div class="mkcard"><div class="stbar fail"><i></i><span><b>没连上我的股市 APP</b> · 结论暂时不可用，可以先打开网页版查看</span><button data-mkretry>重试</button></div></div>';
  }
}


// ---------- 新闻时刻：把新闻发布时间对齐到纳斯达克分时曲线 ----------
let EVENTS = null;
function eventSVG(it, s) {
  const rows = s.rows, W = 320, H = 180, P = 6;
  const vals = rows.map(x => x.v);
  const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || 1;
  const X = i => P + i / Math.max(1, rows.length - 1) * (W - 2 * P);
  const Y = v => P + (hi - v) / span * (H - 2 * P);
  const line = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
  const area = line + ' L' + X(vals.length - 1).toFixed(1) + ',' + H + ' L' + P + ',' + H + ' Z';
  const mx = X(Math.min(it.mark, vals.length - 1));
  // 曲线颜色按曲线自身方向，不按「相对昨收涨跌幅」——低开反弹日两者常常相反
  const cv = vals.length > 1 && vals[vals.length - 1] >= vals[0] ? 'up' : 'down';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<rect x="' + mx.toFixed(1) + '" y="0" width="' + (W - mx).toFixed(1) + '" height="' + H + '" style="fill:var(--brand);opacity:.07"/>' +
    '<path d="' + area + '" style="fill:var(--' + cv + ');opacity:.10"/>' +
    '<path d="' + line + '" style="fill:none;stroke:var(--' + cv + ')" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<line x1="' + mx.toFixed(1) + '" y1="0" x2="' + mx.toFixed(1) + '" y2="' + H + '" style="stroke:var(--brand-ink)" stroke-width="1.6" stroke-dasharray="4 3"/>' +
    '<circle cx="' + mx.toFixed(1) + '" cy="' + Y(vals[Math.min(it.mark, vals.length - 1)]).toFixed(1) + '" r="4.5" style="fill:var(--accent-solid);stroke:var(--card)" stroke-width="2"/></svg>';
}
async function viewEvents() {
  document.body.classList.remove('bed');
  const render = () => {
    const d = EVENTS || { items: [], series: {} }, items = d.items || [];
    const pctTxt = p => p == null ? '当日 —' : '当日 ' + (p > 0 ? '+' : '') + p.toFixed(2) + '%';
    let h = '<div class="wrap"><div class="mvhead"><a class="mvback" href="#/moves" aria-label="返回异动">‹</a>' +
      '<h1 class="title mvtitle">新闻时刻</h1>' +
      '<button class="icon mvrefresh" data-evrefresh aria-label="刷新">⟳</button></div>';
    if (!items.length) h += '<div class="stbar fail"><i></i><span><b>暂时没拉到</b> · 点右上 ⟳ 重试</span><button data-evrefresh>重试</button></div>';
    h += '<a class="evbanner" href="#/quiz"><b>🎲 更多 case · 猜涨跌</b><span>最近几天的题更多，给你新闻你来猜 →</span></a>';
    h += '<div class="evhint">竖线 = 新闻发出时刻 · 右侧浅色 = 之后 · 只做时间对齐，不代表因果</div>';
    let sepDone = false;
    h += items.map((it, i) => {
      const s = d.series[it.sym] || { rows: [], pct: null };
      const cl = it.after > 0 ? 'up' : it.after < 0 ? 'down' : '';
      const pc = it.pct == null ? '' : it.pct > 0 ? 'up' : it.pct < 0 ? 'down' : '';
      let sep = '';
      if (it.post && !sepDone) { sepDone = true; sep = '<div class="evsep">收盘后发布的报道 · 竖线在收盘处</div>'; }
      // 盘后新闻没有「后 15 分钟」，不假装算出一个数字
      const big = it.post
        ? '<div class="evpost">盘后<br>报道</div>'
        : '<div class="evafter ' + cl + '">' + (it.after > 0 ? '+' : '') + it.after.toFixed(2) + '%<small>后 15′</small></div>';
      return sep + '<div class="evcard" data-ev="' + i + '">' +
        '<div class="evtop"><div class="evtime">' + esc(it.hm) + '</div>' +
        '<div class="evname">' + esc(it.name) + '<small class="' + pc + '">' + pctTxt(it.pct) + ' · 相对昨收</small></div>' +
        big + '</div>' +
        '<div class="evchart">' + eventSVG(it, s) + '</div>' +
        '<div class="evnews">' + esc(it.title) + '</div>' +
        '<div class="mvmeta">' + esc(it.src) + ' ↗</div></div>';
    }).join('') + '<p class="mvfoot">分时来自东方财富 · 当日涨跌以昨收为基准（腾讯报价），不是开盘到收盘<br>' +
      '北京时间 · 盘中新闻竖线右侧为发布后；盘后报道竖线在收盘处<br>' + esc(d.session || '') + '</p></div>';
    app.innerHTML = h;
  };
  const load = async force => {
    app.innerHTML = '<div class="wrap"><div class="mvhead"><a class="mvback" href="#/moves">‹</a><h1 class="title mvtitle">新闻时刻</h1></div><div class="skl tall"></div><div class="skl tall"></div></div>';
    try { EVENTS = await (await fetch('data/events.json' + (force ? '?_=' + Date.now() : ''), { cache: 'no-cache' })).json(); }
    catch { EVENTS = { items: [], series: {} }; }
    render();
  };
  app.onclick = e => {
    if (e.target.closest('[data-evrefresh]')) return load(true);
    const c = e.target.closest('[data-ev]');
    if (c) { const it = ((EVENTS && EVENTS.items) || [])[+c.dataset.ev]; if (it && it.url) window.open(it.url, '_blank', 'noopener'); }
  };
  if (!EVENTS) await load(false); else render();
  window.scrollTo(0, 0);
}

// ---------- 猜涨跌：给一条新闻，老大猜相关标的之后是涨是跌 ----------
let QUIZ = null, QIDX = 0, QREVEAL = false, QGUESS = null;
const qStat = () => LS.get('quizStat', {}) || {};
function qRecord(q, guess) {
  const s = qStat(), seen = s.seen || {}, key = q.id || (q.hm + '|' + q.sym);
  if (seen[key]) return s;                 // 同一题只计一次分
  seen[key] = guess; s.seen = seen;
  s.answered = (s.answered || 0) + 1;
  if (guess === q.ans) {
    s.correct = (s.correct || 0) + 1;
    s.streak = (s.streak || 0) + 1;
    s.best = Math.max(s.best || 0, s.streak);
  } else s.streak = 0;
  LS.set('quizStat', s);
  return s;
}
function quizSVG(it, reveal) {
  const rows = (it.prev || []).slice();
  if (reveal && it.result) rows.push(it.result);
  if (rows.length < 2) return '';
  const W = 320, H = 150, P = 8;
  const lo = Math.min.apply(null, rows.map(r => r.l)), hi = Math.max.apply(null, rows.map(r => r.h));
  const span = hi - lo || 1, Y = v => P + (hi - v) / span * (H - 2 * P);
  const step = W / rows.length, bw = Math.max(2.4, step * 0.5);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<line x1="0" y1="' + Y(rows[0].o).toFixed(1) + '" x2="' + W + '" y2="' + Y(rows[0].o).toFixed(1) + '" style="stroke:var(--line)"/>';
  rows.forEach((r, i) => {
    const cx = i * step + step / 2, last = reveal && i === rows.length - 1;
    const col = r.c >= r.o ? 'var(--up)' : 'var(--down)';
    s += '<line x1="' + cx.toFixed(1) + '" y1="' + Y(r.h).toFixed(1) + '" x2="' + cx.toFixed(1) + '" y2="' + Y(r.l).toFixed(1) +
      '" style="stroke:' + col + ';opacity:' + (last ? 1 : .55) + '" stroke-width="1"/>';
    const top = Math.min(Y(r.o), Y(r.c)), hh = Math.max(1.6, Math.abs(Y(r.o) - Y(r.c)));
    s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) +
      '" style="fill:' + col + ';opacity:' + (last ? 1 : .62) + '"' + (last ? ' stroke="var(--ink)" stroke-width="1"' : '') + '/>';
  });
  if (reveal) {
    const mx = (rows.length - 1) * step + step / 2;
    s += '<line x1="' + mx.toFixed(1) + '" y1="0" x2="' + mx.toFixed(1) + '" y2="' + H +
      '" style="stroke:var(--brand-ink);opacity:.6" stroke-width="1.2" stroke-dasharray="3 3"/>';
  }
  return s + '</svg>';
}
async function viewQuiz() {
  document.body.classList.remove('bed');
  const render = () => {
    const items = (QUIZ && QUIZ.items) || [], st = qStat();
    const head = '<div class="wrap"><div class="mvhead"><a class="mvback" href="#/news" aria-label="返回要闻">‹</a>' +
      '<h1 class="title mvtitle">猜涨跌</h1>' +
      '<button class="icon mvrefresh" data-qzreset aria-label="重来">↺</button></div>' +
      '<div class="qzstat"><span>已答 <b>' + (st.answered || 0) + '</b></span><span>答对 <b>' + (st.correct || 0) + '</b></span>' +
      '<span>连对 <b>' + (st.streak || 0) + '</b></span><span>最佳 <b>' + (st.best || 0) + '</b></span>' +
      '<span class="qztotal">' + ((QUIZ && QUIZ.span) ? esc(QUIZ.span) + ' · ' : '') +
      esc(((QUIZ && QUIZ.at) || '').slice(11)) + ' 更新</span></div>';
    if (!items.length) {
      app.innerHTML = head + '<div class="stbar fail"><i></i><span><b>题库暂时没拉到</b> · 点右上 ↺ 重试</span></div></div>';
      return;
    }
    if (QIDX >= items.length) {
      const rate = st.answered ? Math.round((st.correct || 0) / st.answered * 100) : 0;
      app.innerHTML = head + '<div class="qzsum"><div class="qzsumbig">' + rate + '%</div><b>这轮 ' + items.length + ' 题猜完了</b>' +
        '<p>答对 ' + (st.correct || 0) + ' / ' + (st.answered || 0) + ' · 最佳连对 ' + (st.best || 0) + '</p>' +
        '<button class="btn" data-qzreset>再来一轮</button></div></div>';
      return;
    }
    const q = items[QIDX], right = QGUESS === q.ans;
    // 最新交易日的新闻若题库在盘中生成，日K 当日值是「截至生成时」的涨跌，不是收盘价，
    // 所以 same 题不说「收」；只有真有完整下一根日K 的 next 题才说「收涨 / 收跌」。
    const ask = q.kind === 'same' ? '猜：这条新闻发出后，当天是涨还是跌？'
      : '猜：新闻发出后第一个交易日，是收涨还是收跌？';
    const dirWord = q.ans === 'up' ? (q.kind === 'same' ? '上涨' : '收涨')
      : (q.kind === 'same' ? '下跌' : '收跌');
    let h = head + '<div class="qzprog">第 ' + (QIDX + 1) + ' / ' + items.length + ' 题' +
      '<div class="qzbar"><i style="width:' + Math.round(QIDX / items.length * 100) + '%"></i></div></div>';
    h += '<div class="qzcard"><div class="qzmeta">' + esc(q.hm) + ' · ' + esc(q.src) + '</div>' +
      '<div class="qztitle">' + esc(q.title) + '</div>' +
      '<div class="qzrel"><b>' + esc(q.name) + '</b><span>关联词「' + esc(q.hit) + '」</span></div>' +
      '<div class="qzchart">' + quizSVG(q, QREVEAL) + '</div>' +
      '<div class="qzchartcap">' + (QREVEAL ? '虚线 = 结果日 ' + esc(q.day)
        : '此前 ' + (q.prev || []).length + ' 个交易日 · 截至 ' + esc((((q.prev || []).slice(-1)[0] || {}).d || '').slice(5))) + '</div>' +
      (QREVEAL
        ? '<div class="qzres ' + (right ? 'ok' : 'no') + '"><div class="qzverdict">' + (right ? '✓ 猜对了' : '✗ 猜错了') + '</div>' +
          '<div class="qznum ' + (q.ans === 'up' ? 'up' : 'down') + '">' + (q.pct > 0 ? '+' : '') + q.pct.toFixed(2) + '%</div>' +
          '<div class="muted">实际' + dirWord + ' · ' + esc(q.day) + '</div></div>' +
          (q.url ? '<a class="qzlink" href="' + esc(q.url) + '" target="_blank" rel="noopener">看新闻原文 ↗</a>' : '') +
          '<button class="btn qznext" data-qznext>下一题 →</button>'
        : '<div class="qzask">' + ask + '</div>' +
          '<div class="qzbtns"><button class="qzbtn up" data-qzguess="up">📈 涨</button><button class="qzbtn down" data-qzguess="down">📉 跌</button></div>' +
          '<button class="qzskip" data-qznext>跳过这题 →</button>') +
      '</div><p class="mvfoot">只按标题关键词关联，不代表因果 · 结果是真实历史涨跌 · ' +
      (q.kind === 'same' ? '当日口径截至 ' + esc(((QUIZ && QUIZ.at) || '').slice(11)) : '次日口径') + '</p></div>';
    app.innerHTML = h;
  };
  app.onclick = e => {
    if (e.target.closest('[data-qzreset]')) {
      LS.set('quizStat', {}); QIDX = 0; QREVEAL = false; QGUESS = null; render(); toast('战绩已清空'); return;
    }
    const b = e.target.closest('[data-qzguess]');
    if (b && !QREVEAL) {
      const q = ((QUIZ && QUIZ.items) || [])[QIDX];
      if (!q) return;
      QGUESS = b.dataset.qzguess; QREVEAL = true; qRecord(q, QGUESS); render(); window.scrollTo(0, 0); return;
    }
    if (e.target.closest('[data-qznext]')) { QIDX++; QREVEAL = false; QGUESS = null; render(); window.scrollTo(0, 0); }
  };
  if (!QUIZ) {
    app.innerHTML = '<div class="wrap"><div class="mvhead"><a class="mvback" href="#/news">‹</a><h1 class="title mvtitle">猜涨跌</h1></div><div class="skl tall"></div></div>';
    try { QUIZ = await (await fetch('data/quiz.json', { cache: 'no-cache' })).json(); }
    catch { QUIZ = { items: [], at: '' }; }
  }
  render();
  window.scrollTo(0, 0);
}

// ---------- 异动：新闻 × 相关标的，一张卡一张大图，文字压到最少 ----------
let MOVES = null, MVMODE = 'minute';
function moveSVG(it, mode) {
  const W = 320, H = 180, P = 6;
  if (mode === 'day') {
    const rows = it.day || [];
    if (rows.length < 2) return '<div class="mvempty">日K 暂无</div>';
    const lo = Math.min.apply(null, rows.map(x => x.l)), hi = Math.max.apply(null, rows.map(x => x.h)), span = hi - lo || 1;
    const Y = v => P + (hi - v) / span * (H - 2 * P), step = W / rows.length, bw = Math.max(1.6, step * 0.6);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    rows.forEach((r, i) => {
      const x = P + i * step + (step - bw) / 2, cv = r.c >= r.o ? 'up' : 'down';
      const yo = Y(r.o), yc = Y(r.c), top = Math.min(yo, yc), h = Math.max(1.2, Math.abs(yo - yc));
      s += '<line x1="' + (x + bw / 2).toFixed(1) + '" y1="' + Y(r.h).toFixed(1) + '" x2="' + (x + bw / 2).toFixed(1) + '" y2="' + Y(r.l).toFixed(1) + '" style="stroke:var(--' + cv + ')" stroke-width="1"/>' +
        '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" style="fill:var(--' + cv + ')"/>';
    });
    return s + '</svg>';
  }
  const rows = it.minute || [];
  if (rows.length < 5) return '<div class="mvempty">分时暂无 · 切日K</div>';
  const vals = rows.map(x => x.v), prev = it.pct > -100 ? it.price / (1 + it.pct / 100) : vals[0];
  const rng = Math.max(Math.max.apply(null, vals) - prev, prev - Math.min.apply(null, vals), prev * 0.0015);
  const lo = prev - rng * 1.12, hi = prev + rng * 1.12;
  const X = i => P + i / Math.max(1, vals.length - 1) * (W - 2 * P), Y = v => P + (hi - v) / (hi - lo) * (H - 2 * P);
  const line = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
  const area = line + ' L' + X(vals.length - 1).toFixed(1) + ',' + H + ' L' + P + ',' + H + ' Z';
  const cv = vals[vals.length - 1] >= prev ? 'up' : 'down';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<path d="' + area + '" style="fill:var(--' + cv + ');opacity:.13"/>' +
    '<line x1="0" y1="' + Y(prev).toFixed(1) + '" x2="' + W + '" y2="' + Y(prev).toFixed(1) + '" stroke="currentColor" stroke-opacity=".18" stroke-dasharray="3 5" stroke-width="1"/>' +
    '<path d="' + line + '" style="fill:none;stroke:var(--' + cv + ')" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}
async function viewMoves() {
  document.body.classList.remove('bed');
  const render = () => {
    const items = (MOVES && MOVES.items) || [];
    let h = '<div class="wrap"><div class="mvhead">' +
      '<a class="mvback" href="#/news" aria-label="返回要闻">‹</a>' +
      '<h1 class="title mvtitle">异动</h1>' +
      '<button class="icon mvrefresh" data-mvrefresh aria-label="刷新">⟳</button></div>' +
      '<div class="mvsub"><span class="mvat">' + esc((MOVES && MOVES.at) || '') + '</span>' +
      '<div class="mvmodes"><button data-mvmode="minute" class="' + (MVMODE === 'minute' ? 'on' : '') + '">分时</button><button data-mvmode="day" class="' + (MVMODE === 'day' ? 'on' : '') + '">日K</button></div></div>';
    if (!items.length) h += '<div class="stbar fail"><i></i><span><b>暂时没拉到异动</b> · 点右上 ⟳ 重试</span><button data-mvrefresh>重试</button></div>';
    h += '<a class="evbanner" href="#/events"><b>⏱ 新闻时刻</b><span>新闻发出那一刻，分时怎么走的 →</span></a>';
    h += '<a class="evbanner" href="#/quiz"><b>🎲 猜涨跌</b><span>给你新闻你来猜，最近几十条 case →</span></a>';
    h += items.map((it, i) => {
      const c = it.pct > 0 ? 'up' : it.pct < 0 ? 'down' : '', sign = it.pct > 0 ? '+' : '';
      return '<div class="mvcard" data-mv="' + i + '" title="' + esc(it.rel) + '">' +
        '<div class="mvtop"><div class="mvname">' + esc(it.name) + '</div>' +
        '<div class="mvnum ' + c + '"><b>' + sign + it.pct.toFixed(2) + '%</b><small>' + it.price.toFixed(2) + '</small></div></div>' +
        '<div class="mvchart">' + moveSVG(it, MVMODE) + '</div>' +
        '<div class="mvrel">提到「' + esc(it.hit) + '」</div>' +
        '<div class="mvnews">' + esc(it.title) + '</div>' +
        '<div class="mvmeta">' + esc(it.src) + ' · ' + ago(it.time) + ' ↗</div></div>';
    }).join('');
    h += '<p class="mvfoot">行情来自腾讯 · 红涨绿跌 · 可能有延迟</p></div>';
    app.innerHTML = h;
  };
  const load = async force => {
    app.innerHTML = '<div class="wrap"><div class="mvhead"><a class="mvback" href="#/news">‹</a><h1 class="title mvtitle">异动</h1></div><div class="skl tall"></div><div class="skl tall"></div></div>';
    try { MOVES = await (await fetch('data/moves.json' + (force ? '?_=' + Date.now() : ''), { cache: 'no-cache' })).json(); }
    catch { MOVES = { items: [], at: '' }; }
    render();
  };
  app.onclick = e => {
    const m = e.target.closest('[data-mvmode]');
    if (m) { MVMODE = m.dataset.mvmode; render(); return; }
    if (e.target.closest('[data-mvrefresh]')) return load(true);
    const c = e.target.closest('[data-mv]');
    if (c) { const it = ((MOVES && MOVES.items) || [])[+c.dataset.mv]; if (it && it.url) window.open(it.url, '_blank', 'noopener'); }
  };
  if (!MOVES) await load(false); else render();
  window.scrollTo(0, 0);
}

async function viewStock() {
  document.body.classList.remove('bed');
  await getLib('新闻');
  const list = (LOADED['新闻'] || []).filter(n => n.tags.includes('股票') && !(swipes()[n.id] && !swipes()[n.id].l)).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 80);
  const c = CHSYM[CHCUR];
  app.innerHTML = '<div class="wrap"><div class="shelf-head"><h1 class="title" style="margin:0;font-family:var(--sans);font-weight:800"><a href="#/news" style="color:var(--sub);text-decoration:none;font-weight:400;margin-right:4px">‹</a>股市 <span class="muted" id="qat" style="font-size:13px;font-weight:400"></span></h1>' + langBtn() + '</div>' +
    '<div id="mkapp"><div class="skl w1"></div><div class="skl tall"></div></div>' +
    '<div class="stbar" id="stbar"><i></i><span id="stbar-t"><b>正在取行情</b> · 腾讯行情，可能有延迟</span><button data-qretry>刷新</button></div>' +
    '<div class="chartcard"><div class="chart-head"><div><b id="chart-name">' + esc(c[0]) + '</b> <span id="chart-px" class="muted"></span></div><div class="chart-modes"><button data-cmode="minute" class="' + (CHMODE === 'minute' ? 'on' : '') + '">分时</button><button data-cmode="day" class="' + (CHMODE === 'day' ? 'on' : '') + '">日K</button></div></div>' +
    '<div class="chart-syms">' + CHSYM.map((x, i) => '<button data-csym="' + i + '" class="' + (i === CHCUR ? 'on' : '') + '">' + x[0] + '</button>').join('') + '</div>' +
    '<div id="chart"><div class="skl tall"></div></div><div class="muted" style="font-size:11px;margin-top:6px">曲线来自腾讯行情 · 红涨绿跌 · 可能有延迟</div></div>' +
    '<div class="qg"><h4 style="display:flex;justify-content:space-between">⭐ 我的自选<button class="linkbtn" data-watch>编辑</button></h4><div class="qrow" id="wq-row"><p class="muted">加载中…</p></div></div>' +
    '<div id="qs"><div class="skl w2"></div><div class="skl w3"></div></div>' +
    '<div class="muted" style="margin:14px 2px 8px">股市消息</div><div class="news-list">' + (list.map((n, i) => nrow(n, i, '')).join('') || '<p class="muted">暂无</p>') + '</div>' +
    '<p class="muted" style="font-size:12px">仅供参考，不构成投资建议。</p></div>';
  const setStockState = (kind, html) => {
    const bar = $('#stbar'), t = $('#stbar-t');
    if (bar && t) { bar.className = 'stbar ' + kind; t.innerHTML = html; }
  };
  const tick = async () => {
    const box = $('#qs'); if (!box) { clearInterval(QT); return; }
    try {
      const q = await quotes(); LASTQ = q;
      try {
        const ws = watch(), wr = $('#wq-row');
        if (wr && !ws.length) wr.innerHTML = '<p class="muted">点「编辑」添加股票/ETF</p>';
        else if (wr) {
          const t = new TextDecoder('gbk').decode(await (await fetch('https://qt.gtimg.cn/q=' + ws.map(w => wkey(w.c)).join(',') + '&_=' + Date.now(), { cache: 'no-store' })).arrayBuffer()), o = {};
          for (const m of t.matchAll(/v_(\w+)="([^"]*)"/g)) { const f = m[2].split('~'); o[m[1]] = { p: +f[3], c: +f[5] }; }
          wr.innerHTML = ws.map(w => { const v = o[wkey(w.c)] || {}, cl = v.c > 0 ? 'up' : v.c < 0 ? 'down' : ''; return '<div class="q ' + cl + '"><small>' + esc(w.n) + '</small><b>' + (v.p ? v.p.toFixed(v.p < 10 ? 3 : 2) : '--') + '</b><em>' + (isFinite(v.c) ? (v.c > 0 ? '+' : '') + v.c.toFixed(2) + '%' : '') + '</em></div>'; }).join('');
        }
      } catch { }
      box.innerHTML = QS.map(g => '<div class="qg"><h4>' + g[0] + '</h4><div class="qrow">' + g[1].filter(k => q[k] && q[k].p).map(k => { const v = q[k], cl = v.c > 0 ? 'up' : v.c < 0 ? 'down' : ''; return '<div class="q ' + cl + '"><small>' + esc(v.n) + '</small><b>' + v.p.toFixed(2) + '</b><em>' + (v.c > 0 ? '+' : '') + v.c.toFixed(2) + '%</em></div>'; }).join('') + '</div></div>').join('');
      const v = q[CHSYM[CHCUR][1]];
      $('#chart-name').textContent = CHSYM[CHCUR][0];
      $('#chart-px').textContent = v ? v.p.toFixed(2) + '  ' + (v.c > 0 ? '+' : '') + v.c.toFixed(2) + '%' : '';
      const ts = new Date().toTimeString().slice(0, 8);
      $('#qat').textContent = ts + ' 取数';
      setStockState('ok', '<b>行情正常</b> · ' + ts + ' 取数 · 腾讯行情，可能有延迟；美股为最近一次成交');
    } catch {
      if (!box.querySelector('.q')) box.innerHTML = '<div class="stbar fail"><i></i><span><b>行情没拉到</b> · 15 秒后自动重试</span><button data-qretry>刷新</button></div>';
      setStockState('fail', '<b>行情没拉到</b> · 曲线和结论仍可用，点「刷新」重试');
    }
  };
  const redraw = () => {
    const y = window.scrollY;
    app.querySelectorAll('[data-csym]').forEach(b => b.classList.toggle('on', +b.dataset.csym === CHCUR));
    app.querySelectorAll('[data-cmode]').forEach(b => b.classList.toggle('on', b.dataset.cmode === CHMODE));
    const v = LASTQ[CHSYM[CHCUR][1]];
    $('#chart-name').textContent = CHSYM[CHCUR][0];
    $('#chart-px').textContent = v ? v.p.toFixed(2) + '  ' + (v.c > 0 ? '+' : '') + v.c.toFixed(2) + '%' : '';
    window.scrollTo(0, y); renderChart();
  };
  clearInterval(QT); tick(); renderChart(); renderMarketApp();
  QT = setInterval(() => { if (!document.hidden) tick(); }, 15000);
  app.onclick = e => {
    if (e.target.closest('[data-lang]')) { toggleLang(); route(); return; }
    if (e.target.closest('[data-watch]')) return openWatchEdit(() => route());
    if (e.target.closest('[data-qretry]')) return tick();
    if (e.target.closest('[data-mkretry]')) return renderMarketApp();
    if (e.target.closest('[data-chretry]')) return renderChart();
    if (e.target.closest('[data-mkgo]')) {
      const t0 = Date.now(); location.href = MKAPP;
      setTimeout(() => { if (!document.hidden && Date.now() - t0 < 2500) window.open(MKBASE + '#/todo', '_blank'); }, 1200);
      return;
    }
    const cs = e.target.closest('[data-csym]'); if (cs) { CHCUR = +cs.dataset.csym; redraw(); return; }
    const cm = e.target.closest('[data-cmode]'); if (cm) { CHMODE = cm.dataset.cmode; redraw(); return; }
    const x = e.target.closest('[data-no]'); if (x) { doSwipe(list[+x.dataset.no], false); x.closest('.nrow').remove(); toast('会少推这类'); return; }
    const r = e.target.closest('[data-i]'); if (r) openDetail(list[+r.dataset.i]);
  };
  window.scrollTo(0, 0);
}

// ---------- 自己添加 ----------
function guessFromUrl(u) {
  if (/bilibili\.com|b23\.tv|youtube\.com|youtu\.be|douyin\.com|v\.qq\.com/.test(u)) return { type: '视频', platform: /youtu/.test(u) ? 'YouTube' : /bili|b23/.test(u) ? 'B站' : /douyin/.test(u) ? '抖音' : '腾讯视频' };
  if (/xiaoyuzhoufm\.com|ximalaya\.com/.test(u)) return { type: '播客', platform: /xiaoyuzhou/.test(u) ? '小宇宙' : '喜马拉雅' };
  if (/y\.qq\.com|music\.163\.com|kugou|kuwo/.test(u)) return { type: '歌曲', platform: /qq\.com/.test(u) ? 'QQ音乐' : /163/.test(u) ? '网易云音乐' : '其他' };
  if (/book\.douban\.com|weread\.qq\.com/.test(u)) return { type: '书', platform: /douban/.test(u) ? '豆瓣' : '微信读书' };
  if (/movie\.douban\.com/.test(u)) return { type: '电影', platform: '豆瓣' };
  return { type: '', platform: '原文' };
}
function openAdd(prefill = {}) {
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = '<div class="dsheet addf"><h2>添加到我的库</h2><p class="muted">贴一个链接（B站、YouTube、小宇宙、QQ音乐、豆瓣都行），或者只写个名字。加完会直接进清单，也会出现在「刷」里。</p>' +
    '<label>链接（可选）<input id="a_url" inputmode="url" placeholder="https://..." value="' + esc(prefill.url || '') + '"></label>' +
    '<label>类型<div class="kbar" id="a_k" style="padding:4px 0 0;margin:0">' + KIND.filter(k => k !== '新闻' && k !== 'X').map(k => '<button type="button" data-k="' + k + '" style="--kc:' + KC[k] + '">' + KI[k] + ' ' + k + '</button>').join('') + '</div></label>' +
    '<label>名字<input id="a_t" placeholder="比如：漫长的季节 / 晴天" value="' + esc(prefill.title || '') + '"></label>' +
    '<label>作者 / 歌手 / UP主（可选）<input id="a_c"></label>' +
    '<label>一句话备注（可选）<input id="a_h" placeholder="为什么想看，或者记得的一句歌词"></label>' +
    '<div class="btns" style="margin-top:14px"><button class="btn" id="a_ok">♥ 加入清单</button><button class="btn ghost" data-close>取消</button></div></div>';
  document.body.appendChild(el);
  let kind = prefill.type || '';
  const setK = k => { kind = k; el.querySelectorAll('#a_k button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); };
  setK(kind);
  const u = el.querySelector('#a_url'), t = el.querySelector('#a_t'), c = el.querySelector('#a_c');
  u.addEventListener('input', async () => {
    const v = u.value.trim(); const g = guessFromUrl(v); if (g.type && !kind) setK(g.type);
    if (/youtu/.test(v) && !t.value) {   // YouTube 能自动取标题
      try { const j = await (await fetch('https://noembed.com/embed?url=' + encodeURIComponent(v))).json(); if (j.title) { t.value = j.title; c.value = c.value || j.author_name || ''; } } catch { }
    }
  });
  el.addEventListener('click', e => {
    const k = e.target.closest('#a_k [data-k]'); if (k) { setK(k.dataset.k); return; }
    if (e.target.closest('[data-close]') || e.target === el) { el.remove(); return; }
    if (e.target.closest('#a_ok')) {
      const url = u.value.trim(), title = t.value.trim() || url.replace(/^https?:\/\//, '').slice(0, 40);
      if (!title) { toast('写个名字或贴个链接'); return; }
      const g = guessFromUrl(url), type = kind || g.type || '视频';
      const links = url ? [{ platform: g.platform, url }] : (type === '歌曲' ? [{ platform: 'QQ音乐', url: 'https://y.qq.com/n/ryqq/search?w=' + encodeURIComponent(title) }] : type === '书' ? [{ platform: '微信读书', url: 'https://weread.qq.com/web/search/books?keyword=' + encodeURIComponent(title) }] : [{ platform: 'B站', url: 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(title) }, { platform: '豆瓣', url: 'https://search.douban.com/movie/subject_search?search_text=' + encodeURIComponent(title) }]);
      const it = { id: 'u' + Date.now().toString(36), type, title, creator: c.value.trim(), year: '', tags: ['我添加的'], hook: el.querySelector('#a_h').value.trim(), intro: '', len: '', links };
      const m = mine(); m.unshift(it); LS.set('mine', m);
      if (LIB) LIB.unshift(it);
      doSwipe(it, true); el.remove(); toast('♥ 已加入清单'); route();
    }
  });
  setTimeout(() => (prefill.url ? t : u).focus(), 80);
}
document.addEventListener('click', e => { if (e.target.closest('[data-add]')) openAdd(); });

// ---------- 路由 ----------
async function route() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('stock')) { location.replace('#/moves'); return; }  // 旧股市页 → 新闻异动图卡
  const tab = h.startsWith('shelf') ? 'shelf' : (h.startsWith('news') || h.startsWith('moves') || h.startsWith('events') || h.startsWith('quiz')) ? 'news' : h.startsWith('hot') ? 'hot' : h.startsWith('learn') ? 'learn' : (h === '' ? 'disc' : '');
  document.querySelectorAll('.tabs a').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
  document.body.classList.toggle('fixed', tab === 'disc');
  app.onclick = null; clearInterval(QT); clearInterval(LIVET); if (tab !== 'disc') { SONGPLAY = false; stopSong(); }
  document.querySelectorAll('.sheet').forEach(s => s.remove());
  try {
    if (tab === 'disc') await viewDiscover();
    else if (tab === 'shelf') await viewShelf();
    else if (tab === 'hot') await viewHot();
    else if (tab === 'learn') await viewLearn();
    else if (h.startsWith('quiz')) await viewQuiz();
    else if (h.startsWith('events')) await viewEvents();
    else if (h.startsWith('moves')) await viewMoves();
    else if (tab === 'news') await viewNews();
    else if (h.startsWith('cards')) await viewCards();
    else if (h.startsWith('archive')) await viewArchive();
    else if (h.startsWith('me')) await viewMe();
    else await viewIssue(h.startsWith('d/') ? h.slice(2) : null);
  } catch (e) { console.error(e); app.innerHTML = '<div class="wrap"><p class="muted">加载失败：' + esc(e.message) + '<br>检查网络后下拉刷新。</p></div>'; }
}
applyFs();
window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();