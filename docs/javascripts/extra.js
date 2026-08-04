// 首页鼠标动效：跟随光斑 + 轻微视差
document.addEventListener('DOMContentLoaded', function () {
  var hero = document.querySelector('.mdx-hero');
  if (!hero) return;

  // 鼠标跟随光斑（白雾效果）
  var glow = document.createElement('div');
  glow.className = 'mdx-hero__glow';
  hero.appendChild(glow);

  var inner = hero.querySelector('.mdx-hero__inner');
  var rect;

  hero.addEventListener('mouseenter', function () {
    rect = hero.getBoundingClientRect();
    glow.style.opacity = '1';
  });

  hero.addEventListener('mousemove', function (e) {
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    glow.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    // 内容轻微视差偏移，跟随鼠标方向
    inner.style.transform =
      'translate(' + ((x / rect.width - 0.5) * 12) + 'px,' +
      ((y / rect.height - 0.5) * 12) + 'px)';
  });

  hero.addEventListener('mouseleave', function () {
    glow.style.opacity = '0';
    inner.style.transform = '';
  });
});
