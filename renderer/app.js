'use strict';
/* global smucl */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const api = window.smucl;

const S = {
  settings: null,
  javaList: [],
  dirs: [],
  installed: [],
  manifest: null,
  manifestLoading: false,
  filter: 'all',
  search: '',
  installing: new Map(),
  selected: '', // `${dir}|${id}`
  running: null,
  memoryTotal: 16384,
  logOpen: false,
  latest: null,
  updateDismissed: null,
  saves: null,
  savesLoading: false,
  appInfo: null,
  updateInfo: null,
  updateState: null,
  updatePrompted: null,
};

/* ---------------------------------------------------------------- 主题 */
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const THEME_ICON = {
  // 当前深色 → 按钮展示太阳（点击切浅色）；当前浅色 → 展示月亮
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M4.3 12H2.1M21.9 12h-2.2M6.5 6.5 4.9 4.9M19.1 19.1l-1.6-1.6M17.5 6.5l1.6-1.6M4.9 19.1l1.6-1.6"/>',
  moon: '<path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2z"/>',
};

function resolveTheme(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  return darkQuery.matches ? 'dark' : 'light';
}

function applyTheme(pref) {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  const icon = $('#themeIcon');
  if (icon) icon.innerHTML = theme === 'dark' ? THEME_ICON.sun : THEME_ICON.moon;
  const btn = $('#btnTheme');
  if (btn) btn.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
}

darkQuery.addEventListener('change', () => {
  if (S.settings && S.settings.theme === 'auto') applyTheme('auto');
});

const TYPE_LABEL = {
  release: '正式版',
  snapshot: '快照',
  old_beta: '旧版 Beta',
  old_alpha: '旧版 Alpha',
};

const KIND_LABEL = {
  primary: '主目录',
  official: '官方启动器',
  PCL: 'PCL',
  HMCL: 'HMCL',
  BakaXL: 'BakaXL',
  custom: '自定义',
};

/* ---------------------------------------------------------------- 工具 */
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtRelative(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  const day = 86400000;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < day * 30) return `${Math.floor(diff / day)} 天前`;
  return fmtDate(new Date(ms).toISOString());
}

const keyOf = (v) => `${v.dir}|${v.id}`;

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 320);
  }, 3200);
}

function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/* ---------------------------------------------------------------- 弹窗 */
function openModal({ title, sub = '', html = '', buttons = [] }) {
  $('#modalTitle').textContent = title;
  $('#modalSub').textContent = sub;
  $('#modalBody').innerHTML = html;
  const foot = $('#modalFoot');
  foot.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = b.primary ? 'btn-sm btn-primary' : 'btn-sm';
    el.textContent = b.text;
    el.onclick = b.onClick || closeModal;
    foot.appendChild(el);
  }
  $('#modalMask').hidden = false;
}

function closeModal() {
  $('#modalMask').hidden = true;
}

/* ---------------------------------------------------------------- 更新 */
async function checkUpdate(silent = true) {
  if (!silent) toast('正在检查更新…');
  const r = await api.checkUpdate({ silent });
  S.updateState = { ...r, at: Date.now() };
  renderUpdateState();
  if (!r.ok) {
    if (!silent) toast(r.error, 'err');
    return r;
  }
  S.updateInfo = r;
  if (!r.hasUpdate) {
    if (!silent) toast(`已是最新版本 v${r.current}`, 'ok');
    return r;
  }
  if (S.updatePrompted === r.latest) return r;
  S.updatePrompted = r.latest;
  showUpdateModal(r);
  return r;
}

/** 侧栏提示条 + 关于页的状态文字 */
function renderUpdateState() {
  const st = S.updateState;
  const pill = $('#updatePill');
  const about = $('#aboutUpdate');
  if (!st || !pill) return;

  if (st.ok && st.hasUpdate) {
    pill.hidden = false;
    pill.textContent = `发现 v${st.latest} · 点此更新`;
    if (about) {
      about.textContent = `发现新版本 v${st.latest}（当前 v${st.current}）`;
      about.classList.add('has-new');
    }
  } else {
    pill.hidden = true;
    if (about) {
      about.classList.remove('has-new');
      about.textContent = st.ok
        ? `已是最新版本 v${st.current} · ${fmtTime(st.at)} 检查`
        : `检查失败：${st.error}`;
    }
  }
}

function showUpdateModal(info) {
  const notes = (info.notes || '').trim();
  const body = notes
    ? `<div class="cl-title">${esc(info.name || 'v' + info.latest)}</div><div>${esc(notes)}</div>`
    : `<div>发现新版本 v${esc(info.latest)}，当前 v${esc(info.current)}。更新包只包含应用代码，下载约 1 MB，完成后会自动重启。</div>`;

  const buttons = [{ text: '稍后', onClick: closeModal }];
  if (info.url) buttons.push({ text: '查看发布页', onClick: () => api.openUrl(info.url) });
  if (info.asset) {
    buttons.push({ text: '立即更新', primary: true, onClick: () => startUpdate(info) });
  } else if (info.url) {
    buttons.push({ text: '去下载', primary: true, onClick: () => api.openUrl(info.url) });
  }

  openModal({
    title: `发现新版本 v${info.latest}`,
    sub: `当前 v${info.current} · ${info.source === 'release' ? 'GitHub Release' : 'GitHub 标签'}`,
    html: body,
    buttons,
  });
}

async function startUpdate(info) {
  const body = $('#modalBody');
  body.innerHTML = `
    <div class="cl-title">正在下载更新包</div>
    <div class="up-progress"><i style="width:0%"></i></div>
    <div class="up-note" id="upNote">准备中…</div>`;
  $('#modalFoot').innerHTML = '';

  const r = await api.installUpdate(info.asset);
  if (!r.ok) {
    body.innerHTML = `<div class="cl-title">更新失败</div><div>${esc(r.error)}</div>
      <div class="up-note">可前往发布页手动下载。</div>`;
    const foot = $('#modalFoot');
    const b1 = document.createElement('button');
    b1.className = 'btn-sm';
    b1.textContent = '关闭';
    b1.onclick = closeModal;
    const b2 = document.createElement('button');
    b2.className = 'btn-sm btn-primary';
    b2.textContent = '前往发布页';
    b2.onclick = () => api.openUrl(info.url);
    foot.append(b1, b2);
  }
  // 成功时主进程会在 1.2 秒后自动重启，这里只负责展示进度
}

function setUpdateProgress({ percent }) {
  const bar = $('.up-progress i');
  const note = $('#upNote');
  if (bar) bar.style.width = `${percent || 0}%`;
  if (note) note.textContent = percent >= 100 ? '下载完成，正在重启…' : `已下载 ${percent || 0}%`;
}

/* ---------------------------------------------------------------- 更新日志 */
function showChangelog(version) {
  const list = window.CHANGELOG || [];
  if (!list.length) {
    openModal({ title: '更新日志', sub: '', html: '<div>暂无记录。</div>', buttons: [{ text: '知道了', primary: true }] });
    return;
  }
  const entries = version ? list.filter((e) => e.version === version) : list.slice(0, 2);
  const html = entries
    .map(
      (e) => `
      <div class="cl-title">v${esc(e.version)} · ${esc(e.title)}</div>
      <ul>${e.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    )
    .join('<div style="height:14px"></div>');

  openModal({
    title: version ? `v${version} 更新内容` : '更新日志',
    sub: version ? entries[0]?.date || '' : '最近两个版本',
    html,
    buttons: [{ text: '知道了', primary: true }],
  });
}


/* ---------------------------------------------------------------- 视图 */
let currentView = 'home';
function switchView(name) {
  currentView = name;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $('.content').scrollTop = 0;
  if (name === 'saves' && S.saves === null) loadSaves({ quiet: true });
  if (name === 'versions') refreshSizes();
}

/* ---------------------------------------------------------------- 渲染 */
function renderAll() {
  renderPlaySelect();
  renderInstalled();
  renderSettings();
  renderJavaSummary();
  renderDirs();
  updateUpdateBar();
  $('#navVersionCount').textContent = String(S.installed.length);
  $('#navSaveCount').textContent = S.saves ? String(S.saves.length) : '0';
  $('#sidePlayer').textContent = S.settings.playerName || 'Steve';
  $('#avatar').textContent = (S.settings.playerName || 'S').slice(0, 1).toUpperCase();
}

function currentVersion() {
  return S.installed.find((v) => keyOf(v) === S.selected) || null;
}

function renderPlaySelect() {
  const sel = $('#versionSelect');
  const multiDir = new Set(S.installed.map((v) => v.dir)).size > 1;

  if (!S.installed.length) {
    sel.innerHTML = '<option value="">（尚未安装版本）</option>';
    S.selected = '';
  } else {
    const keys = S.installed.map(keyOf);
    if (!S.selected || !keys.includes(S.selected)) S.selected = keys[0];
    sel.innerHTML = S.installed
      .map((v) => {
        const label = multiDir ? `${v.id}  ·  ${v.dirName}` : v.id;
        return `<option value="${esc(keyOf(v))}">${esc(label)}</option>`;
      })
      .join('');
    sel.value = S.selected;
  }

  const cur = currentVersion();
  const chip = $('#playTypeChip');
  if (cur) {
    const bits = [TYPE_LABEL[cur.type] || cur.type, cur.loader];
    if (cur.mods) bits.push(`${cur.mods} 模组`);
    chip.textContent = bits.join(' · ');
    chip.className = 'chip chip-blue';
    $('#playMeta').textContent = `Java ${cur.javaMajor}+ · ${cur.dirName} · 最近使用 ${fmtRelative(cur.updatedAt)}`;
  } else {
    chip.textContent = '未选择';
    chip.className = 'chip';
    $('#playMeta').textContent = '尚未安装任何版本';
  }

  const btn = $('#playBtn');
  btn.disabled = !S.selected && !S.running;
  btn.classList.toggle('stop', Boolean(S.running));
  $('.mc-btn-face', btn).textContent = S.running ? '结 束 游 戏' : '开 始 游 戏';
}

function renderInstalled() {
  const grid = $('#versionGrid');
  const empty = $('#versionsEmpty');
  if (!S.installed.length) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  grid.innerHTML = S.installed
    .map((v) => {
      const typeChip = v.type === 'release' ? 'chip-green' : v.type === 'snapshot' ? 'chip-gold' : 'chip';
      return `
      <div class="v-card" data-key="${esc(keyOf(v))}">
        <div class="v-card-top">
          <div>
            <div class="v-id" title="${esc(v.id)}">${esc(v.id)}</div>
            <div class="v-sub">${TYPE_LABEL[v.type] || v.type} · 需要 Java ${v.javaMajor}+</div>
          </div>
          <span class="chip ${v.hasJar ? 'chip-green' : 'chip-gold'}">${v.hasJar ? '完整' : '缺 jar'}</span>
        </div>
        <div class="v-tags">
          <span class="chip chip-blue">${esc(v.loader)}</span>
          ${v.mods ? `<span class="chip">${v.mods} 模组</span>` : ''}
          ${v.isolated ? '<span class="chip">版本隔离</span>' : ''}
          <span class="chip">${esc(v.dirName)}</span>
        </div>
        <div class="v-stats">
          <div><span>占用空间</span><b data-size="${esc(keyOf(v))}">计算中…</b></div>
          <div><span>最近使用</span><b>${fmtRelative(v.updatedAt)}</b></div>
        </div>
        <div class="v-actions">
          <button class="btn-sm btn-primary" data-act="launch">启动</button>
          <button class="btn-sm" data-act="folder">目录</button>
          <button class="btn-sm" data-act="copy">命令</button>
          <button class="btn-sm btn-danger" data-act="remove">删除</button>
        </div>
      </div>`;
    })
    .join('');
  // 体积统计较耗时：仅在版本页可见时计算
  if (currentView === 'versions') refreshSizes();
}

function patchSize(key, size) {
  const el = $(`[data-size="${CSS.escape(key)}"]`);
  if (el) el.textContent = fmtBytes(size);
}

function renderJavaSummary() {
  const s = S.settings;
  const picked = s.javaPath ? S.javaList.find((j) => j.path === s.javaPath || j.java === s.javaPath) : null;
  const show = picked || S.javaList[0];
  $('#kvJava').textContent = show ? `Java ${show.major} (${show.version})` : '未检测到';
  $('#kvVersions').textContent = `${S.installed.length} 个`;
  $('#kvMemory').textContent = `${(s.memory / 1024).toFixed(1).replace('.0', '')} GB`;
  const dir = s.mcDir || '';
  $('#kvDir').textContent = dir;
  $('#kvDir').title = dir;

  const mods = S.installed.reduce((n, v) => n + (v.mods || 0), 0);
  $('#kvSaves').textContent = `${S.saves ? S.saves.length : '—'} / ${mods}`;
}

function renderDirs() {
  const counts = new Map();
  for (const v of S.installed) counts.set(v.dir, (counts.get(v.dir) || 0) + 1);

  $('#dirList').innerHTML = S.dirs
    .map((d) => {
      const n = counts.get(d.path) || 0;
      const isPrimary = d.kind === 'primary';
      return `
      <div class="dir-item ${isPrimary ? 'primary' : ''}" data-path="${esc(d.path)}">
        <div class="dir-main">
          <b>${esc(KIND_LABEL[d.kind] || d.name)} ${n ? `<span class="chip">${n} 个实例</span>` : ''}</b>
          <span title="${esc(d.path)}">${esc(d.path)}</span>
        </div>
        <div class="dir-actions">
          ${isPrimary ? '<span class="chip chip-blue">安装目标</span>' : '<button class="btn-sm" data-act="primary">设为主目录</button>'}
          ${d.kind === 'custom' ? '<button class="btn-sm" data-act="remove">移除</button>' : ''}
          <button class="btn-sm" data-act="open">打开</button>
        </div>
      </div>`;
    })
    .join('');
}

function renderSettings() {
  const s = S.settings;

  const autoItem = `
    <div class="java-item ${!s.javaPath ? 'selected' : ''}" data-java="">
      <span class="j-dot"></span>
      <div class="j-main">
        <b>自动选择（推荐）</b>
        <span>按版本要求匹配最合适的 Java</span>
      </div>
      <span class="j-tag chip">默认</span>
    </div>`;
  $('#javaList').innerHTML =
    autoItem +
    S.javaList
      .map(
        (j) => `
      <div class="java-item ${s.javaPath === j.path ? 'selected' : ''}" data-java="${esc(j.path)}">
        <span class="j-dot"></span>
        <div class="j-main">
          <b>Java ${j.major} · ${esc(j.version)}</b>
          <span title="${esc(j.path)}">${esc(j.source)} · ${j.bits || '?'} 位 · ${esc(j.path)}</span>
        </div>
        <span class="j-tag chip ${j.major >= 17 ? 'chip-green' : ''}">${esc(j.vendor || 'Java')}</span>
      </div>`
      )
      .join('');

  $('#javaPathInput').value = s.javaPath || '';
  $('#mcDirInput').value = s.mcDir || '';

  const memGB = (m) => `${(m / 1024).toFixed(1).replace('.0', '')} GB`;
  const maxMem = Math.min(16384, Math.max(2048, Math.floor(S.memoryTotal / 1024) * 1024));
  [$('#memory'), $('#memory2')].forEach((el) => {
    el.max = String(maxMem);
    el.value = String(Math.min(s.memory, maxMem));
  });
  $('#memLabel').textContent = memGB(s.memory);
  $('#memLabel2').textContent = memGB(s.memory);
  $('#memHint').textContent = `物理内存 ${(S.memoryTotal / 1024).toFixed(0)} GB，建议分配 4~8 GB，不超过一半。`;

  $('#jvmArgs').value = s.jvmArgs || '';
  $('#fullscreenSwitch').checked = Boolean(s.fullscreen);
  $('#showLogSwitch').checked = s.showLog !== false;
  $('#autoCheckSwitch').checked = s.autoCheck !== false;
  $('#gpuFallbackSwitch').checked = Boolean(s.gpuFallback);
  $('#threads').value = String(s.downloadThreads || 8);
  $('#threadLabel').textContent = String(s.downloadThreads || 8);

  $$('#sourceSwitch .seg, #sourceSwitch2 .seg').forEach((b) =>
    b.classList.toggle('active', b.dataset.source === s.downloadSource)
  );

  $$('#themeSwitch .seg').forEach((b) => b.classList.toggle('active', b.dataset.theme === (s.theme || 'auto')));

  $('#playerName').value = s.playerName || 'Steve';
  $('#sidePlayer').textContent = s.playerName || 'Steve';
  $('#avatar').textContent = (s.playerName || 'S').slice(0, 1).toUpperCase();
}

/* ---------------------------------------------------------------- 更新提示 */
function updateUpdateBar() {
  const latest = S.latest && S.latest.release;
  const installedIds = new Set(S.installed.map((v) => v.id));
  const hasLatest = latest ? installedIds.has(latest) : false;
  const newer = Boolean(latest) && !hasLatest;

  $('#kvLatest').textContent = latest ? `${latest}` : '检查中…';

  const dot = $('#navUpdateDot');
  if (dot) dot.hidden = !newer;

  const bar = $('#updateBar');
  if (bar) {
    bar.hidden = !newer || S.updateDismissed === latest;
    if (newer) {
      $('#updateVersion').textContent = latest;
      const snap = S.latest.snapshot;
      $('#updateHint').textContent =
        latest === snap ? '官方已发布最新快照，可安装体验' : '官方已发布新的正式版，可一键安装';
    }
  }
}

/* ---------------------------------------------------------------- 下载列表 */
function filteredVersions() {
  if (!S.manifest) return [];
  let list = S.manifest.versions;
  if (S.filter !== 'all') list = list.filter((v) => v.type === S.filter);
  const q = S.search.trim().toLowerCase();
  if (q) list = list.filter((v) => v.id.toLowerCase().includes(q));
  return list;
}

function renderDownloadList() {
  const wrap = $('#dlList');
  if (S.manifestLoading) {
    wrap.innerHTML = '<div class="dl-loading"><span class="spinner"></span>正在获取版本列表…</div>';
    return;
  }
  if (!S.manifest) {
    wrap.innerHTML = '<div class="dl-loading">版本列表尚未加载，点击右上角「刷新列表」重试。</div>';
    return;
  }

  const list = filteredVersions();
  if (!list.length) {
    wrap.innerHTML = '<div class="dl-loading">没有匹配的版本。</div>';
    return;
  }

  const installedMap = new Map(S.installed.map((v) => [v.id, v]));
  const latestRelease = S.manifest.latest?.release;
  const latestSnapshot = S.manifest.latest?.snapshot;

  wrap.innerHTML = list
    .map((v) => {
      const known = installedMap.get(v.id);
      const inst = S.installing.get(v.id);
      const isLatest = v.id === latestRelease || v.id === latestSnapshot;
      let action = '';
      if (inst) {
        action = `
          <div class="dl-progress">
            <div class="progress"><i style="width:${inst.percent || 0}%"></i></div>
            <small>${esc(inst.message || '安装中…')}${inst.percent ? ` · ${inst.percent}%` : ''}</small>
          </div>`;
      } else if (known && known.hasJar) {
        action = '<button class="btn-sm" disabled>已安装</button>';
      } else if (known) {
        action = `<button class="btn-sm btn-primary" data-install="${esc(v.id)}">修复</button>`;
      } else {
        action = `<button class="btn-sm btn-primary" data-install="${esc(v.id)}">安装</button>`;
      }
      const typeChip = v.type === 'release' ? 'chip-green' : v.type === 'snapshot' ? 'chip-gold' : 'chip';
      return `
        <div class="dl-row" data-row="${esc(v.id)}">
          <div class="dl-id">
            ${isLatest ? '<span class="latest-dot"></span>' : ''}
            <span>${esc(v.id)}</span>
            <span class="chip ${typeChip}">${TYPE_LABEL[v.type] || v.type}</span>
          </div>
          <div class="dl-date">${fmtDate(v.releaseTime)}</div>
          <div class="dl-action">${action}</div>
        </div>`;
    })
    .join('');
}

function updateInstallRow(p) {
  const row = $(`[data-row="${CSS.escape(p.id)}"] .dl-action`);
  if (!row || p.stage === 'error') return;
  const percent = Math.max(0, Math.min(100, p.percent || 0));
  row.innerHTML = `
    <div class="dl-progress">
      <div class="progress"><i style="width:${percent}%"></i></div>
      <small>${esc(p.message || '安装中…')}${p.stage === 'download' ? ` · ${percent}%` : ''}</small>
    </div>`;
}

/* ---------------------------------------------------------------- 存档 */
function saveCardHtml(s) {
  const icon = s.icon
    ? `<img src="${s.icon}" alt="" />`
    : `<svg viewBox="0 0 24 24"><path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z"/><path d="M4 7.5 12 11l8-3.5"/><path d="M12 11v9"/></svg>`;
  const tags = [
    s.hardcore ? '<span class="chip chip-gold">硬核</span>' : '',
    s.wasModded ? '<span class="chip">模组世界</span>' : '',
    s.broken ? '<span class="chip chip-gold">无法读取</span>' : '',
  ]
    .filter(Boolean)
    .join('');
  const where = s.instanceId ? `实例 ${s.instanceId}` : '全局存档';
  return `
      <div class="save-card" data-path="${esc(s.path)}">
        <div class="save-icon ${s.icon ? '' : 'fallback'}">${icon}</div>
        <div class="save-body">
          <div class="save-name">${esc(s.name)}${tags}</div>
          <div class="save-meta">${esc(s.version || '未知版本')} · ${esc(s.gameType || '—')} · ${esc(where)}</div>
          <div class="save-foot">最后游玩 ${fmtRelative(s.lastPlayed)} · ${fmtBytes(s.size)}</div>
        </div>
        <div class="save-actions">
          <button class="btn-sm" data-act="reveal">定位</button>
          <button class="btn-sm btn-danger" data-act="trash">删除</button>
        </div>
      </div>`;
}

// 版本号降序（新的在前），快照等非数字版本退回字符串比较，未知版本垫底
function compareVersionDesc(a, b) {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const pa = String(a).split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b).split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return String(b).localeCompare(String(a));
}

function saveVersionGroups(saves) {
  const map = new Map();
  for (const s of saves) {
    const v = s.version || '未知版本';
    if (!map.has(v)) map.set(v, []);
    map.get(v).push(s);
  }
  for (const items of map.values()) items.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return map;
}

function renderSavesByPack(saves) {
  const packs = new Map();
  for (const s of saves) {
    const key = s.instanceId ? `${s.dir}::${s.instanceId}` : `${s.dir}::__global__`;
    if (!packs.has(key)) {
      packs.set(key, {
        name: s.instanceId || '全局存档',
        isGlobal: !s.instanceId,
        path: s.dir,
        items: [],
      });
    }
    packs.get(key).items.push(s);
  }
  const list = Array.from(packs.values()).sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) return a.isGlobal ? 1 : -1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return list
    .map((g) => {
      g.items.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
      return `
      <section class="save-group">
        <div class="save-group-head">
          <b>${esc(g.name)}</b>
          <span class="save-group-path" title="${esc(g.path)}">${esc(g.path)}</span>
          <em>${g.items.length} 个存档</em>
        </div>
        <div class="save-list">${g.items.map(saveCardHtml).join('')}</div>
      </section>`;
    })
    .join('');
}

function renderSavesByTime(saves) {
  const sorted = saves.slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return `<div class="save-list">${sorted.map(saveCardHtml).join('')}</div>`;
}

function renderSavesByVersion(saves) {
  const entries = Array.from(saveVersionGroups(saves).entries());
  entries.sort((a, b) => compareVersionDesc(a[0], b[0]));

  return entries
    .map(
      ([v, items]) => `
      <section class="save-group">
        <div class="save-group-head">
          <b class="save-group-ver">${esc(v)}</b>
          <em>${items.length} 个存档</em>
        </div>
        <div class="save-list">${items.map(saveCardHtml).join('')}</div>
      </section>`
    )
    .join('');
}

function renderSaves() {
  const list = $('#saveList');
  const empty = $('#savesEmpty');
  const saves = S.saves || [];
  const mode = S.settings.saveGroup || 'folder';

  const totalSize = saves.reduce((n, s) => n + (s.size || 0), 0);
  const dirs = new Set(saves.map((s) => s.dir));
  $('#sumCount').textContent = `${saves.length} 个`;
  $('#sumSize').textContent = fmtBytes(totalSize);
  $('#sumDirs').textContent = `${dirs.size} 个`;
  $('#navSaveCount').textContent = String(saves.length);

  $$('#saveGroupSwitch .seg').forEach((b) => b.classList.toggle('active', b.dataset.group === mode));

  if (!saves.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML =
    mode === 'folder'
      ? renderSavesByPack(saves)
      : mode === 'time'
        ? renderSavesByTime(saves)
        : renderSavesByVersion(saves);
}

function setSavesLoading(loading, text) {
  S.savesLoading = loading;
  const box = $('#saveProgress');
  if (box) box.hidden = !loading;
  if (text) $('#saveProgressText').textContent = text;
}

/* ---------------------------------------------------------------- 日志 */
function appendLog(line) {
  const body = $('#logBody');
  const div = document.createElement('div');
  div.textContent = line;
  if (/^\[ERR\]|\bERROR\b|\bException\b|\bCaused by\b/.test(line)) div.className = 'l-err';
  else if (/\bWARN\b|\b警告\b/.test(line)) div.className = 'l-warn';
  else if (line.startsWith('>')) div.className = 'l-sys';
  body.appendChild(div);
  while (body.childElementCount > 800) body.removeChild(body.firstChild);
  body.scrollTop = body.scrollHeight;
}

function setLogOpen(open) {
  S.logOpen = open;
  $('#logPanel').hidden = !open;
  $('#logFab').hidden = open;
}

/* ---------------------------------------------------------------- 数据加载 */
async function refreshInstalledAndRender() {
  const r = await api.installed();
  if (r.ok) {
    S.installed = r.data;
    S.sizesDone = false;
    renderAll();
    renderDownloadList();
  }
}

async function refreshSizes() {
  if (S.sizing || S.sizesDone) return;
  S.sizing = true;
  const r = await api.sizes();
  S.sizing = false;
  S.sizesDone = true;
  if (r.ok && r.data) {
    for (const [k, v] of Object.entries(r.data)) patchSize(k, v);
  }
}

async function loadManifest(force = false) {
  S.manifestLoading = true;
  renderDownloadList();
  const r = await api.manifest({ force });
  S.manifestLoading = false;
  if (r.ok) {
    S.manifest = r.data;
    if (r.data.latest) {
      S.latest = { release: r.data.latest.release, snapshot: r.data.latest.snapshot, source: r.data.source };
      updateUpdateBar();
      const timeEl = $('#checkTime');
      if (timeEl) {
        timeEl.textContent = `最近检查 ${fmtTime(r.data.checkedAt || Date.now())} · 最新正式版 ${r.data.latest.release}`;
      }
    }
    if (r.data.source && S.settings && r.data.source !== S.settings.downloadSource) {
      toast(r.data.source === 'mojang' ? '镜像不可达，已临时改用官方源' : '官方源不可达，已改用镜像加速', 'warn');
    }
  } else {
    S.manifest = null;
    toast(r.error, 'err');
  }
  renderDownloadList();
}

async function loadSaves({ quiet = false } = {}) {
  if (S.savesLoading) return;
  setSavesLoading(true, '正在扫描存档…');
  const r = await api.saves();
  setSavesLoading(false);
  if (!r.ok) {
    toast('存档扫描失败：' + r.error, 'err');
    return;
  }
  S.saves = r.data.saves;
  renderSaves();
  renderJavaSummary();
  if (!quiet) toast(`扫描完成，共 ${r.data.saves.length} 个存档`, 'ok');
}

async function startInstall(id) {
  if (!S.manifest) await loadManifest(false);
  const entry = S.manifest && S.manifest.versions.find((v) => v.id === id);
  if (!entry) {
    toast('未找到版本元数据，请刷新列表', 'warn');
    return;
  }
  switchView('download');

  S.installing.set(id, { percent: 0, message: '准备中…' });
  renderDownloadList();
  const r = await api.install(id, entry.url);
  S.installing.delete(id);
  if (r.ok) {
    toast(`${id} 安装完成，共 ${fmtBytes(r.data.bytes)}`, 'ok');
    await refreshInstalledAndRender();
    const added = S.installed.find((v) => v.id === id);
    if (added) S.selected = keyOf(added);
    renderPlaySelect();
  } else {
    toast(`安装失败：${r.error}`, 'err');
  }
  renderDownloadList();
  updateUpdateBar();
}

/* ---------------------------------------------------------------- 事件 */
function bindEvents() {
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

  $('#btnMin').onclick = () => api.win.minimize();
  $('#btnMax').onclick = () => api.win.maximize();
  $('#btnClose').onclick = () => api.win.close();

  // 主题：标题栏一键切换，设置页三态
  $('#btnTheme').onclick = () => {
    const cur = resolveTheme(S.settings.theme);
    const next = cur === 'dark' ? 'light' : 'dark';
    S.settings.theme = next;
    applyTheme(next);
    renderSettings();
    api.save({ theme: next });
  };
  $$('#themeSwitch .seg').forEach((b) => {
    b.onclick = () => {
      S.settings.theme = b.dataset.theme;
      applyTheme(b.dataset.theme);
      renderSettings();
      api.save({ theme: b.dataset.theme });
    };
  });

  // 弹窗
  $('#modalClose').onclick = closeModal;
  $('#modalMask').addEventListener('click', (e) => {
    if (e.target === $('#modalMask')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modalMask').hidden) closeModal();
  });

  // 应用更新
  $('#btnCheckUpdate').onclick = () => checkUpdate(false);
  $('#btnShowChangelog').onclick = () => showChangelog(S.appInfo ? S.appInfo.version : null);
  $('#updatePill').onclick = () => {
    if (S.updateInfo && S.updateInfo.hasUpdate) showUpdateModal(S.updateInfo);
  };

  $$('[data-open]').forEach((b) => (b.onclick = () => api.openUrl(b.dataset.open)));

  $('#versionSelect').onchange = (e) => {
    S.selected = e.target.value;
    renderPlaySelect();
  };

  const saveName = debounce((name) => {
    api.save({ playerName: name }).then((r) => {
      if (r.ok) {
        S.settings = r.data;
        $('#sidePlayer').textContent = name;
        $('#avatar').textContent = name.slice(0, 1).toUpperCase();
      }
    });
  }, 400);
  $('#playerName').addEventListener('input', (e) => {
    const name = e.target.value.replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 16);
    e.target.value = name;
    $('#sidePlayer').textContent = name || 'Steve';
    $('#avatar').textContent = (name || 'S').slice(0, 1).toUpperCase();
    saveName(name || 'Steve');
  });

  const saveMem = debounce((val) => {
    api.save({ memory: val }).then((r) => {
      if (r.ok) S.settings = r.data;
    });
  }, 400);
  const onMem = (e) => {
    const val = Number(e.target.value);
    S.settings.memory = val;
    const gb = `${(val / 1024).toFixed(1).replace('.0', '')} GB`;
    $('#memLabel').textContent = gb;
    $('#memLabel2').textContent = gb;
    $('#kvMemory').textContent = gb;
    $('#memory').value = String(val);
    $('#memory2').value = String(val);
    saveMem(val);
  };
  $('#memory').addEventListener('input', onMem);
  $('#memory2').addEventListener('input', onMem);

  // 启动 / 停止
  $('#playBtn').onclick = async () => {
    if (S.running) {
      const r = await api.kill();
      if (!r.ok) toast(r.error, 'err');
      return;
    }
    const cur = currentVersion();
    if (!cur) {
      toast('请先安装一个游戏版本', 'warn');
      switchView('download');
      return;
    }
    const btn = $('#playBtn');
    btn.disabled = true;
    $('.mc-btn-face', btn).textContent = '启 动 中…';
    const r = await api.launch(cur.id, cur.dir);
    btn.disabled = false;
    if (!r.ok) {
      $('.mc-btn-face', btn).textContent = '开 始 游 戏';
      toast(r.error, 'err');
      appendLog(`> 启动失败：${r.error}`);
      if (S.settings.showLog !== false) setLogOpen(true);
      return;
    }
    S.running = r.data.pid;
    setLogOpen(true);
    appendLog(`> 使用 Java ${r.data.java.major}（${r.data.java.version}）启动 ${cur.id}`);
    renderPlaySelect();
    toast('游戏启动中，请稍候…', 'ok');
  };

  $('#btnOpenGameDir').onclick = () => api.openPath('game');
  $('#btnGoDownload').onclick = () => switchView('download');
  $('#btnEmptyGoDownload').onclick = () => switchView('download');
  $('#btnOpenVersionsDir').onclick = () => api.openPath(`${S.settings.mcDir}\\versions`);
  $('#btnUpdateNow').onclick = () => startInstall(S.latest.release);
  $('#btnUpdateDismiss').onclick = () => {
    S.updateDismissed = S.latest.release;
    updateUpdateBar();
  };

  $('#btnDetectJava').onclick = async () => {
    toast('正在检测 Java…');
    const r = await api.detectJava();
    if (r.ok) {
      S.javaList = r.data;
      renderSettings();
      renderJavaSummary();
      toast(`检测到 ${r.data.length} 个 Java 运行时`, r.data.length ? 'ok' : 'warn');
    } else toast(r.error, 'err');
  };

  $('#btnRefreshInstalled').onclick = refreshInstalledAndRender;

  // 版本卡动作
  $('#versionGrid').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const key = btn.closest('.v-card').dataset.key;
    const v = S.installed.find((x) => keyOf(x) === key);
    if (!v) return;
    if (btn.dataset.act === 'launch') {
      S.selected = key;
      renderPlaySelect();
      switchView('home');
      $('#playBtn').click();
    } else if (btn.dataset.act === 'folder') {
      api.openPath(`${v.dir}\\versions\\${v.id}`);
    } else if (btn.dataset.act === 'copy') {
      const r = await api.command(v.id, v.dir);
      if (r.ok) {
        const ok = await copyText(r.data);
        toast(ok ? '启动命令已复制到剪贴板' : '复制失败', ok ? 'ok' : 'err');
      } else toast(r.error, 'err');
    } else if (btn.dataset.act === 'remove') {
      if (!confirm(`确定删除版本 ${v.id}？会移除该实例目录，不可撤销。`)) return;
      const r = await api.remove(v.id, v.dir);
      if (r.ok) {
        toast('版本已删除', 'ok');
        refreshInstalledAndRender();
      } else toast(r.error, 'err');
    }
  });

  // 下载筛选
  $('#typeFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-btn');
    if (!btn) return;
    $$('#typeFilter .chip-btn').forEach((b) => b.classList.toggle('active', b === btn));
    S.filter = btn.dataset.type;
    renderDownloadList();
  });

  const onSearch = debounce(() => renderDownloadList(), 160);
  $('#searchInput').addEventListener('input', (e) => {
    S.search = e.target.value;
    onSearch();
  });

  $('#btnRefreshManifest').onclick = () => loadManifest(true);

  $('#dlList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-install]');
    if (!btn) return;
    startInstall(btn.dataset.install);
  });

  // 下载源
  $$('#sourceSwitch .seg, #sourceSwitch2 .seg').forEach((b) => {
    b.onclick = async () => {
      const source = b.dataset.source;
      if (source === S.settings.downloadSource) return;
      const r = await api.save({ downloadSource: source });
      if (r.ok) {
        S.settings = r.data;
        renderSettings();
        toast(source === 'bmcl' ? '已切换到镜像加速源' : '已切换到官方源');
        loadManifest(true);
      }
    };
  });

  // 设置：Java
  $('#javaList').addEventListener('click', async (e) => {
    const item = e.target.closest('.java-item');
    if (!item) return;
    const path = item.dataset.java;
    const r = await api.save({ javaPath: path });
    if (r.ok) {
      S.settings = r.data;
      renderSettings();
      renderJavaSummary();
      toast(path ? '已指定 Java 运行时' : '已切换为自动选择 Java', 'ok');
    }
  });

  $('#btnRescanJava').onclick = async () => {
    const r = await api.detectJava();
    if (r.ok) {
      S.javaList = r.data;
      renderSettings();
      renderJavaSummary();
      toast(`扫描完成，共 ${r.data.length} 个 Java`, 'ok');
    }
  };

  $('#btnPickJava').onclick = async () => {
    const r = await api.pickJava();
    if (r.ok && r.data) {
      const saved = await api.save({ javaPath: r.data });
      if (saved.ok) {
        S.settings = saved.data;
        await api.detectJava().then((x) => x.ok && (S.javaList = x.data));
        renderSettings();
        renderJavaSummary();
        toast('已指定 Java 路径', 'ok');
      }
    }
  };

  $('#jvmArgs').addEventListener('input', debounce((e) => api.save({ jvmArgs: e.target.value }), 500));
  $('#fullscreenSwitch').onchange = (e) => api.save({ fullscreen: e.target.checked });
  $('#showLogSwitch').onchange = (e) => api.save({ showLog: e.target.checked });
  $('#autoCheckSwitch').onchange = (e) => {
    api.save({ autoCheck: e.target.checked });
    toast(e.target.checked ? '已开启后台版本检查' : '已关闭后台版本检查');
  };
  $('#gpuFallbackSwitch').onchange = (e) => {
    api.save({ gpuFallback: e.target.checked });
    toast('设置已保存，重启启动器后生效');
  };

  $('#btnPickMcDir').onclick = async () => {
    const r = await api.pickDir();
    if (r.ok && r.data) {
      const saved = await api.setPrimaryDir(r.data);
      if (saved.ok) {
        S.settings = saved.data.settings;
        S.dirs = saved.data.dirs;
        S.installed = saved.data.installed;
        renderAll();
        renderDownloadList();
        toast('主目录已更新', 'ok');
      }
    }
  };
  $('#btnRevealMcDir').onclick = () => api.openPath('game');

  $('#threads').addEventListener(
    'input',
    debounce((e) => {
      const n = Number(e.target.value);
      $('#threadLabel').textContent = String(n);
      api.save({ downloadThreads: n });
    }, 300)
  );

  // 目录管理
  $('#btnAddDir').onclick = async () => {
    const r = await api.addDir();
    if (r.ok && r.data) {
      S.dirs = r.data.dirs;
      S.installed = r.data.installed;
      S.settings = r.data.settings;
      renderAll();
      renderDownloadList();
      toast('目录已添加', 'ok');
    }
  };

  $('#dirList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const item = btn.closest('.dir-item');
    const path = item.dataset.path;
    const act = btn.dataset.act;
    if (act === 'open') {
      api.openPath(path);
    } else if (act === 'primary') {
      const r = await api.setPrimaryDir(path);
      if (r.ok) {
        S.settings = r.data.settings;
        S.dirs = r.data.dirs;
        S.installed = r.data.installed;
        renderAll();
        renderDownloadList();
        toast('已设为主目录', 'ok');
      } else toast(r.error, 'err');
    } else if (act === 'remove') {
      const r = await api.removeDir(path);
      if (r.ok) {
        S.dirs = r.data.dirs;
        S.installed = r.data.installed;
        S.settings = r.data.settings;
        renderAll();
        renderDownloadList();
        toast('目录已移除', 'ok');
      }
    }
  });

  // 存档
  $('#btnRefreshSaves').onclick = () => {
    S.saves = null;
    loadSaves();
  };
  $$('#saveGroupSwitch .seg').forEach((b) => {
    b.onclick = () => {
      if (S.settings.saveGroup === b.dataset.group) return;
      S.settings.saveGroup = b.dataset.group;
      api.save({ saveGroup: b.dataset.group });
      renderSaves();
    };
  });
  $('#btnOpenPrimarySaves').onclick = () => api.openPath(`${S.settings.mcDir}\\saves`);
  $('#saveList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const path = btn.closest('.save-card').dataset.path;
    if (btn.dataset.act === 'reveal') {
      api.revealSave(path);
    } else if (btn.dataset.act === 'trash') {
      if (!confirm(`确定删除存档？\n${path}\n\n将移动到回收站，可从回收站还原。`)) return;
      const r = await api.trashSave(path);
      if (r.ok) {
        toast('存档已移至回收站', 'ok');
        S.saves = (S.saves || []).filter((s) => s.path !== path);
        renderSaves();
        renderJavaSummary();
      } else toast(r.error, 'err');
    }
  });

  // 日志
  $('#btnToggleLog').onclick = () => setLogOpen(false);
  $('#btnClearLog').onclick = () => ($('#logBody').innerHTML = '');
  $('#logFab').onclick = () => setLogOpen(true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.logOpen) setLogOpen(false);
  });
}

/* ---------------------------------------------------------------- 启动 */
async function boot() {
  bindEvents();

  const st = await api.state();
  if (!st.ok) {
    toast('初始化失败：' + st.error, 'err');
    return;
  }
  S.settings = st.data.settings;
  S.javaList = st.data.javaList || [];
  S.dirs = st.data.dirs || [];
  S.installed = st.data.installed || [];
  S.latest = st.data.latest || null;
  S.memoryTotal = st.data.memoryTotal || 16384;

  // 主题尽早应用，避免首帧闪一下
  applyTheme(S.settings.theme || 'auto');

  const info = await api.appInfo();
  if (info.ok) {
    S.appInfo = info.data;
    $('#aboutVersion').textContent = `v${info.data.version}`;
    $('#aboutVersionText').textContent = info.data.version;
    const hint = $('.side-hint');
    if (hint) hint.textContent = `SMUCL v${info.data.version} · Electron ${String(info.data.electron).split('.')[0]}`;
  }

  renderAll();

  // Java 探测耗时较长，放在首屏之后异步补齐
  api.detectJava().then((r) => {
    if (r.ok) {
      S.javaList = r.data;
      renderSettings();
      renderJavaSummary();
    }
  });

  api.onInstall((p) => {
    if (!p || !p.id) return;
    if (p.stage === 'error') {
      S.installing.delete(p.id);
      renderDownloadList();
      return;
    }
    const cur = S.installing.get(p.id) || {};
    S.installing.set(p.id, { percent: p.percent ?? cur.percent ?? 0, message: p.message || cur.message });
    updateInstallRow(p);
  });

  api.onLog(({ line }) => appendLog(line));
  api.onError(({ message }) => {
    appendLog(`> 进程错误：${message}`);
    toast('游戏进程启动失败：' + message, 'err');
  });
  api.onExit(({ code }) => {
    S.running = null;
    appendLog(`> 游戏进程已结束（退出码 ${code}）`);
    renderPlaySelect();
    if (code === 0) toast('游戏已正常退出', 'ok');
    else if (code !== null) toast(`游戏异常退出，代码 ${code}`, 'warn');
  });

  api.onLatest((info) => {
    S.latest = info;
    updateUpdateBar();
    const has = S.installed.some((v) => v.id === info.release);
    if (!has) toast(`发现新版本 ${info.release}`, 'ok');
    if (S.manifest) loadManifest(false);
  });

  api.onSavesProgress(({ done, total }) => {
    if (S.savesLoading) $('#saveProgressText').textContent = `正在读取 ${done}/${total} 个存档…`;
  });

  api.onVersionSize(({ key, size }) => patchSize(key, size));

  // 应用更新事件
  api.onUpdateAvailable((info) => {
    S.updateInfo = info;
    if (S.updatePrompted === info.latest) return;
    S.updatePrompted = info.latest;
    showUpdateModal(info);
  });
  api.onUpdateProgress((p) => setUpdateProgress(p));
  api.onUpdateFailed(() => {
    /* 静默失败，避免打扰 */
  });

  // 升级后首次启动弹出更新日志（若有可用更新，让位给更新提示）
  const curVersion = S.appInfo && S.appInfo.version;
  if (curVersion && S.settings.lastSeenVersion !== curVersion) {
    setTimeout(() => {
      const hasNew = S.updateState && S.updateState.ok && S.updateState.hasUpdate;
      if (!hasNew) showChangelog(curVersion);
      api.save({ lastSeenVersion: curVersion });
    }, 3000);
  }

  // 启动后自动检查自身更新，并在运行期间每 30 分钟复查一次
  if (S.settings.autoUpdateCheck !== false) {
    setTimeout(() => checkUpdate(true), 2500);
    setInterval(() => checkUpdate(true), 30 * 60 * 1000);
  }

  if (!S.installed.length) {
    setTimeout(() => toast('未检测到已安装版本，可在「设置 → 游戏目录」中添加', 'warn'), 900);
  }

  // 错峰加载：先出版本列表，再扫存档，避免启动时同时遍历十几 GB
  setTimeout(() => loadManifest(false), 250);
  setTimeout(() => loadSaves({ quiet: true }), 2000);
}

boot();
