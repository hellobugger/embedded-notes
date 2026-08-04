// 鼠标粒子拖尾：划过时产生彩色小颗粒与星星，缓缓飘散
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return; // 尊重系统"减弱动态"设置
  }

  var canvas = document.createElement('canvas');
  canvas.id = 'fx-canvas';
  canvas.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'pointer-events:none;z-index:9999;';
  document.body.appendChild(canvas);

  var ctx = canvas.getContext('2d');
  var particles = [];
  var W = 0;
  var H = 0;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // 与站点主题匹配的配色
  var colors = ['#536dfe', '#7c4dff', '#40c4ff', '#ffd740', '#69f0ae', '#ff5252'];

  function spawn(x, y) {
    var burst = 2; // 每次移动产生 2 个颗粒
    for (var i = 0; i < burst; i++) {
      particles.push({
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 3,
        vy: (Math.random() - 0.5) * 3 - 0.5,
        life: 0,
        maxLife: 40 + Math.random() * 30,
        size: 1.5 + Math.random() * 2.5,
        color: colors[(Math.random() * colors.length) | 0],
        star: Math.random() < 0.25 // 约 1/4 是星星
      });
    }
    if (particles.length > 400) {
      particles.splice(0, particles.length - 400);
    }
  }

  document.addEventListener('mousemove', function (e) {
    spawn(e.clientX, e.clientY);
  });

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
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.02; // 轻微重力，像水花下落

      var t = 1 - p.life / p.maxLife; // 1 -> 0 逐渐淡出
      if (t <= 0) { particles.splice(i, 1); continue; }

      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      var r = p.size * t + 0.5;
      if (p.star) {
        drawStar(p.x, p.y, r * 2, p.life * 0.1);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
