// 用 Node 模拟浏览器环境，实际执行 extra.js 并模拟点击齿轮按钮
// 验证：修复前 -> 点齿轮面板会被立刻关闭（"没反应"）；修复后 -> 面板能打开
const fs = require('fs');

// ---- 最小 DOM/事件模拟 ----
function makeEl(tag) {
  return {
    tagName: tag, hidden: false, className: '', id: '', title: '',
    innerHTML: '', type: '', value: '', checked: false,
    _listeners: {},
    classList: { add() {}, remove() {}, contains: () => false },
    style: { cssText: '', setProperty(k, v) { this[k] = v; } },
    setAttribute() {},
    appendChild() {},
    querySelector: () => makeEl('input'),
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    dispatch(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev || { stopPropagation() {} })); },
    getContext() {
      return {
        clearRect() {}, beginPath() {}, arc() {}, fill() {}, lineTo() {},
        closePath() {}, fillRect() {},
        set fillStyle(v) {}, set globalAlpha(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}
      };
    }
  };
}

const btn = makeEl('button');
const panel = makeEl('div');
const document = {
  body: makeEl('body'),
  createElement: (t) => (t === 'button' ? btn : t === 'div' ? panel : makeEl(t)),
  addEventListener(type, fn) { this['_doc_' + type] = fn; },
  querySelector: () => null,
  querySelectorAll: () => []
};
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); }
};
global.document = document;
global.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {}, matchMedia: () => ({ matches: false }) };
global.requestAnimationFrame = (fn) => { setTimeout(fn, 0); return 1; };
global.cancelAnimationFrame = () => {};
global.addEventListener = () => {};

// 事件对象：带 stopPropagation 标记
function mkEvent() { return { _stopped: false, stopPropagation() { this._stopped = true; } }; }

const code = fs.readFileSync(process.argv[2], 'utf8');
eval(code);

// 初始面板应是隐藏
const initiallyHidden = panel.hidden;
console.log('初始面板 hidden =', initiallyHidden);

// 模拟点击齿轮
const ev1 = mkEvent();
btn.dispatch('click', ev1);
console.log('点击后 panel.hidden =', panel.hidden, '| 事件被 stopPropagation =', ev1._stopped);
console.log('document 的 click 监听是否被调用后关闭 =', document._doc_click ? '存在' : '无');

const afterOpen = !panel.hidden;
const wasStopped = ev1._stopped;

// 若修复成功：面板打开 且 事件冒泡被阻止
if (afterOpen && wasStopped) {
  console.log('PASS — 齿轮点击正常打开面板，且不会立即被 document 关闭');
  process.exit(0);
} else {
  console.log('FAIL — 面板状态:', afterOpen ? '打开' : '仍是关闭', '| 冒泡阻止:', wasStopped ? '是' : '否');
  process.exit(1);
}
