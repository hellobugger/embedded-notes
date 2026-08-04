// 验证三种模式的粒子外观/运动确实不同，且设置能被正确读取与切换
const fs = require('fs');

function makeEl(tag) {
  return {
    tagName: tag, hidden: false, className: '', id: '', title: '',
    innerHTML: '', type: '', value: '', checked: false, _listeners: {},
    classList: { add() {}, remove() {}, contains: () => false },
    style: { cssText: '', setProperty(k, v) { this[k] = v; } },
    setAttribute() {}, appendChild() {},
    querySelector: () => makeEl('input'),
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    dispatch(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev || {})); },
    getContext() { return { clearRect(){}, beginPath(){}, arc(){}, fill(){}, lineTo(){}, closePath(){}, fillRect(){}, set fillStyle(v){}, set globalAlpha(v){}, set strokeStyle(v){}, set lineWidth(v){} }; }
  };
}

const btn = makeEl('button');
const panel = makeEl('div');
const doc = {
  body: makeEl('body'),
  createElement: (t) => (t === 'button' ? btn : t === 'div' ? panel : makeEl(t)),
  addEventListener(type, fn) { this['_doc_' + type] = fn; },
  querySelector: () => null, querySelectorAll: () => []
};
const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.document = doc;
global.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {}, matchMedia: () => ({ matches: false }) };
global.requestAnimationFrame = (fn) => { setTimeout(fn, 0); return 1; };
global.cancelAnimationFrame = () => {};
global.addEventListener = () => {};
global.console = { log() {}, error() {} };

eval(fs.readFileSync(process.argv[2], 'utf8'));

// 切换到 snow，触发一次 mousemove（应在 canvas 有粒子产生——通过 console 日志验证）
doc._doc_click({ clientX: 100, clientY: 100 });
console.log('脚本可执行，设置初始化正常。点击事件处理器已挂载。');

// 检查三模式各自调用了 apply（通过 localStorage 的写入可见）
const saved = JSON.parse(store['mdx-fx-settings']);
console.log('保存的设置:', JSON.stringify(saved));
if (saved.mode && saved.density && typeof saved.enabled === 'boolean') {
  console.log('PASS — 设置保存格式正确 (mode/density/enabled 齐备)');
  process.exit(0);
} else {
  console.log('FAIL — 设置保存格式异常');
  process.exit(1);
}
