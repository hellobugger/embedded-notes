// 鼠标特效：可配置（星尘 / 泡泡 / 雪花 / 关闭），设置存在 localStorage
(function () {
  'use strict';

  var KEY = 'mdx-fx-settings';
  var DEFAULTS = { enabled: true, mode: 'star', density: 2 };
  var s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));

  // ---------- 画布 ----------
  var canvas = document.createElement('canvas');
  canvas.id = 'fx-canvas';
  canvas.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'pointer-events:none;z-index:9999;display:none;';
  document.body.appendChild(canvas);

  var ctx = canvas.getContext('2d');
  var W = 0, H = 0;
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  var COLORS = ['#536dfe', '#7c4dff', '#40c4ff', '#ffd740', '#69f0ae', '#ff5252'];
  var particles = [];
  var rafId = null;

  function spawn(x, y) {
    if (!(s.enabled && s.mode !== 'none')) return;
    for (var i = 0; i < s.density; i++) {
      var roll = Math.random();
      var type = s.mode === 'star' ? (roll < 0.25 ? 'star' : 'dot') : s.mode;
      var isBubble = s.mode === 'bubble';
      particles.push({
        type: type,
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3 - (isBubble ? 1.4 : 0.4),
        life: 0,
        maxLife: s.mode === 'snow' ? 70 + Math.random() * 40 : 40 + Math.random() * 30,
        size: 1.5 + Math.random() * 2.5,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        rot: Math.random() * Math.PI * 2
      });
    }
    if (particles.length > 500) particles.splice(0, particles.length - 500);
  }

  function drawStar(x, y, size, rot) {
    ctx.beginPath();
    for (var i = 0; i < 5; i++) {
      var a = rot + i * (Math.PI * 2 / 5);
      ctx.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
      var a2 = a + Math.PI / 5;
      ctx.lineTo(x + Math.cos(a2) * size * 0.5, y + Math.sin(a2) * size * 0.5);
    }
    ctx.closePath();
    ctx.fill();
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life++; p.x += p.vx; p.y += p.vy;
      if (p.type === 'dot' || p.type === 'star') p.vy += 0.02;      // 星尘：下落
      else if (p.type === 'bubble') p.vy -= 0.015;                  // 泡泡：上浮
      else if (p.type === 'snow') { p.vx += Math.sin(p.life * 0.05) * 0.06; p.vy += 0.02; } // 雪花：飘

      var t = 1 - p.life / p.maxLife;
      if (t <= 0) { particles.splice(i, 1); continue; }

      ctx.globalAlpha = p.type === 'bubble' ? t * 0.5 : t;
      ctx.fillStyle = p.color;
      var r = p.size * t + 0.5;
      if (p.type === 'star') drawStar(p.x, p.y, r * 2, p.rot);
      else if (p.type === 'bubble') { ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.6, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    rafId = requestAnimationFrame(frame);
  }

  window.addEventListener('mousemove', function (e) {
    if (s.enabled && s.mode !== 'none') spawn(e.clientX, e.clientY);
  });

  // ---------- 应用设置 ----------
  function apply() {
    var active = s.enabled && s.mode !== 'none';
    canvas.style.display = active ? 'block' : 'none';
    if (active && !rafId) rafId = requestAnimationFrame(frame);
    else if (!active) { cancelAnimationFrame(rafId); rafId = null; particles = []; ctx.clearRect(0, 0, W, H); }
    syncPanel();
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  // ---------- 设置面板 UI ----------
  var MODES = [['star', '⭐ 星尘'], ['bubble', '🫧 泡泡'], ['snow', '❄️ 雪花'], ['none', '🚫 关闭']];

  var btn = document.createElement('button');
  btn.className = 'fx-gear';
  btn.type = 'button';
  btn.title = '鼠标特效设置';
  btn.setAttribute('aria-label', '鼠标特效设置');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';
  document.body.appendChild(btn);

  var panel = document.createElement('div');
  panel.className = 'fx-panel';
  panel.hidden = true;
  panel.innerHTML =
    '<div class="fx-panel__title">鼠标特效</div>' +
    '<label class="fx-row">模式<select id="fx-mode">' +
      MODES.map(function (m) { return '<option value="' + m[0] + '"' + (s.mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') +
    '</select></label>' +
    '<label class="fx-row">密度<input id="fx-density" type="range" min="1" max="4" step="1" value="' + s.density + '"></label>' +
    '<label class="fx-row"><span>开启</span><input id="fx-enabled" type="checkbox"' + (s.enabled ? ' checked' : '') + '></label>';
  document.body.appendChild(panel);

  function syncPanel() {
    panel.querySelector('#fx-mode').value = s.mode;
    panel.querySelector('#fx-density').value = s.density;
    panel.querySelector('#fx-enabled').checked = s.enabled;
  }

  btn.addEventListener('click', function () {
    panel.hidden = !panel.hidden;
  });
  panel.addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('click', function () { panel.hidden = true; });

  panel.querySelector('#fx-mode').addEventListener('change', function (e) { s.mode = e.target.value; apply(); });
  panel.querySelector('#fx-density').addEventListener('input', function (e) { s.density = +e.target.value; apply(); });
  panel.querySelector('#fx-enabled').addEventListener('change', function (e) { s.enabled = e.target.checked; apply(); });

  apply();
})();
