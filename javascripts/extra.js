// 鼠标特效 + 背景图：可配置，设置存在 localStorage
(function () {
  'use strict';

  var KEY = 'mdx-fx-settings';
  var MODES = ['star', 'bubble', 'snow', 'none'];

  // 预设背景图（公开稳定可访问的图片）
  var BG_PRESETS = [
    ['无', ''],
    ['星空山景', 'https://picsum.photos/id/1018/1920/1080'],
    ['城市夜景', 'https://picsum.photos/id/1043/1920/1080'],
    ['雪山湖泊', 'https://picsum.photos/id/1036/1920/1080'],
    ['星云', 'https://picsum.photos/id/1080/1920/1080']
  ];

  // 读取并规范化设置（防御 localStorage 里的旧/脏数据）
  var raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  var s = {
    enabled: raw.enabled !== false,
    mode: MODES.indexOf(raw.mode) >= 0 ? raw.mode : 'star',
    density: Math.max(1, Math.min(4, +raw.density || 2)),
    bgEnabled: !!raw.bgEnabled,
    bgPresetIdx: Math.min(BG_PRESETS.length - 1, Math.max(0, +raw.bgPresetIdx || 0)),
    bgCustom: !!raw.bgCustom,
    bgUrl: typeof raw.bgUrl === 'string' ? raw.bgUrl : '',
    bgOpacity: Math.max(0, Math.min(100, +raw.bgOpacity || 40))
  };

  // ---------- 鼠标特效画布 ----------
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
  var SNOW_COLORS = ['#ffffff', '#cfe8ff', '#a8d8ff'];
  var particles = [];
  var rafId = null;

  function makeParticle(x, y, vx, vy) {
    var p = { x: x, y: y, vx: vx, vy: vy, life: 0, type: s.mode };
    if (s.mode === 'star') {
      p.maxLife = 50 + Math.random() * 30;
      p.size = 2 + Math.random() * 3;
      p.color = COLORS[(Math.random() * COLORS.length) | 0];
      p.isStar = Math.random() < 0.3;
    } else if (s.mode === 'bubble') {
      p.maxLife = 60 + Math.random() * 40;
      p.size = 4 + Math.random() * 5;
      p.color = COLORS[(Math.random() * COLORS.length) | 0];
    } else {
      p.maxLife = 90 + Math.random() * 60;
      p.size = 2.5 + Math.random() * 3.5;
      p.color = SNOW_COLORS[(Math.random() * SNOW_COLORS.length) | 0];
    }
    return p;
  }

  function spawn(x, y, count, radial) {
    var c = Math.round(count);
    for (var i = 0; i < c; i++) {
      var vx, vy;
      if (radial) {
        var a = Math.random() * Math.PI * 2;
        var sp = 1 + Math.random() * 4;
        vx = Math.cos(a) * sp; vy = Math.sin(a) * sp - 1;
      } else {
        vx = (Math.random() - 0.5) * 3;
        vy = (Math.random() - 0.5) * 3 - (s.mode === 'bubble' ? 1.6 : 0.4);
      }
      particles.push(makeParticle(x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, vx, vy));
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
      if (p.type === 'star') p.vy += 0.02;
      else if (p.type === 'snow') { p.vx += Math.sin(p.life * 0.04) * 0.05; p.vy += 0.015; }

      var t = 1 - p.life / p.maxLife;
      if (t <= 0) { particles.splice(i, 1); continue; }

      var r = p.size * (0.5 + 0.5 * t);
      if (p.type === 'bubble') {
        ctx.globalAlpha = t * 0.35;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = t * 0.85;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      } else if (p.type === 'star' && p.isStar) {
        ctx.globalAlpha = Math.min(1, t * 1.3);
        ctx.fillStyle = p.color;
        drawStar(p.x, p.y, r * 2, p.life * 0.1);
      } else {
        ctx.globalAlpha = Math.min(1, t * 1.3);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    rafId = requestAnimationFrame(frame);
  }

  window.addEventListener('mousemove', function (e) {
    if (s.enabled && s.mode !== 'none') spawn(e.clientX, e.clientY, s.density * 2, false);
  });
  document.addEventListener('click', function (e) {
    if (s.enabled && s.mode !== 'none') spawn(e.clientX, e.clientY, s.density * 8, true);
  });

  // ---------- 背景图应用 ----------
  function currentBgUrl() {
    if (!s.bgEnabled) return '';
    return s.bgCustom ? (s.bgUrl || '') : (BG_PRESETS[s.bgPresetIdx] ? BG_PRESETS[s.bgPresetIdx][1] : '');
  }

  // 采样背景图亮度：暗图 -> 白字，亮图 -> 深色字
  function setHeroFg(dark) {
    document.body.style.setProperty('--fx-hero-fg', dark ? '#ffffff' : '#1a1a2e');
  }
  function applyHeroText() {
    var url = currentBgUrl();
    if (!url) { document.body.style.removeProperty('--fx-hero-fg'); return; }
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = c.height = 8;
      var g = c.getContext('2d');
      g.drawImage(img, 0, 0, 8, 8);
      try {
        var d = g.getImageData(0, 0, 8, 8).data;
        var sum = 0;
        for (var i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        setHeroFg(sum / (d.length / 4) / 255 < 0.55);
      } catch (e) { /* CORS 阻止采样：保持主题默认色 */ }
    };
    img.src = url;
  }

  function applyBg() {
    var url = currentBgUrl();
    var body = document.body;
    if (url) {
      body.classList.add('fx-bg');
      body.style.setProperty('--fx-bg-url', 'url("' + url + '")');
      // 不透明度 -> 遮罩 alpha：opacity 越高图片越明显
      var overlay = Math.round((1 - s.bgOpacity / 100 * 0.9) * 100) / 100;
      body.style.setProperty('--fx-bg-overlay-alpha', overlay.toFixed(2));
    } else {
      body.classList.remove('fx-bg');
    }
    applyHeroText();
  }

  // ---------- 设置应用 ----------
  function apply() {
    var active = s.enabled && s.mode !== 'none';
    canvas.style.display = active ? 'block' : 'none';
    if (active && !rafId) rafId = requestAnimationFrame(frame);
    else if (!active) { cancelAnimationFrame(rafId); rafId = null; particles = []; ctx.clearRect(0, 0, W, H); }
    applyBg();
    syncPanel();
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    console.log('[鼠标特效] 已应用: 模式=' + s.mode + ' 密度=' + s.density + ' 开启=' + s.enabled + ' 背景=' + (currentBgUrl() ? 'on' : 'off'));
  }

  // ---------- 设置面板 UI ----------
  var MODE_ITEMS = [
    ['star', '⭐ 星尘'], ['bubble', '🫧 泡泡'], ['snow', '❄️ 雪花'], ['none', '🚫 关闭']
  ];

  var btn = document.createElement('button');
  btn.className = 'fx-gear';
  btn.type = 'button';
  btn.title = '特效与背景设置';
  btn.setAttribute('aria-label', '特效与背景设置');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';
  document.body.appendChild(btn);

  var panel = document.createElement('div');
  panel.className = 'fx-panel';
  panel.hidden = true;
  panel.innerHTML =
    '<div class="fx-panel__title">鼠标特效</div>' +
    '<label class="fx-row">模式<select id="fx-mode">' +
      MODE_ITEMS.map(function (m) { return '<option value="' + m[0] + '"' + (s.mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') +
    '</select></label>' +
    '<label class="fx-row">密度<input id="fx-density" type="range" min="1" max="4" step="1" value="' + s.density + '"></label>' +
    '<label class="fx-row"><span>开启</span><input id="fx-enabled" type="checkbox"' + (s.enabled ? ' checked' : '') + '></label>' +
    '<div class="fx-divider"></div>' +
    '<div class="fx-panel__title">背景图</div>' +
    '<label class="fx-row"><span>启用背景</span><input id="fx-bgen" type="checkbox"' + (s.bgEnabled ? ' checked' : '') + '></label>' +
    '<label class="fx-row">来源<select id="fx-bgsrc">' +
      '<option value="preset"' + (s.bgCustom ? '' : ' selected') + '>预设图片</option>' +
      '<option value="custom"' + (s.bgCustom ? ' selected' : '') + '>网图链接</option>' +
    '</select></label>' +
    '<label class="fx-row">预设<select id="fx-bgpreset">' +
      BG_PRESETS.map(function (p, i) { return '<option value="' + i + '"' + (s.bgPresetIdx === i && !s.bgCustom ? ' selected' : '') + '>' + p[0] + '</option>'; }).join('') +
    '</select></label>' +
    '<input id="fx-bgurl" class="fx-url" type="text" placeholder="https://图片链接.jpg" value="' + (s.bgUrl || '').replace(/"/g, '&quot;') + '">' +
    '<label class="fx-row"><span>明显度</span><input id="fx-bgop" type="range" min="0" max="100" step="1" value="' + s.bgOpacity + '"></label>';
  document.body.appendChild(panel);

  function syncPanel() {
    panel.querySelector('#fx-mode').value = s.mode;
    panel.querySelector('#fx-density').value = s.density;
    panel.querySelector('#fx-enabled').checked = s.enabled;
    panel.querySelector('#fx-bgen').checked = s.bgEnabled;
    panel.querySelector('#fx-bgsrc').value = s.bgCustom ? 'custom' : 'preset';
    panel.querySelector('#fx-bgpreset').value = String(s.bgPresetIdx);
    panel.querySelector('#fx-bgurl').value = s.bgUrl || '';
    panel.querySelector('#fx-bgop').value = s.bgOpacity;
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  panel.addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('click', function () { panel.hidden = true; });

  panel.querySelector('#fx-mode').addEventListener('change', function (e) { s.mode = e.target.value; apply(); });
  panel.querySelector('#fx-density').addEventListener('input', function (e) { s.density = +e.target.value; apply(); });
  panel.querySelector('#fx-enabled').addEventListener('change', function (e) { s.enabled = e.target.checked; apply(); });
  panel.querySelector('#fx-bgen').addEventListener('change', function (e) { s.bgEnabled = e.target.checked; apply(); });
  panel.querySelector('#fx-bgsrc').addEventListener('change', function (e) { s.bgCustom = e.target.value === 'custom'; apply(); });
  panel.querySelector('#fx-bgpreset').addEventListener('change', function (e) { s.bgPresetIdx = +e.target.value; apply(); });
  panel.querySelector('#fx-bgop').addEventListener('input', function (e) { s.bgOpacity = +e.target.value; apply(); });
  // 网图链接：失焦或回车时应用
  panel.querySelector('#fx-bgurl').addEventListener('change', function (e) { s.bgUrl = e.target.value.trim(); apply(); });

  apply();
})();
