(function () {
  // 红黄绿窗口按钮 + 窗口拖拽区（侧边栏品牌条 logoRow + 主区标题条 titleRow）。
  if (document.getElementById('dsh-traffic-lights')) return
  if (!window.dshWindow) return

  // 用 [class*=] 而不是 hash 类名，应用重新构建换了 hash 也不会失效。
  var BARS = '[class*="logoRow"],[class*="titleRow"]'
  var CLS = ['[class*="logoRow"]', '[class*="titleRow"]']
  var SEL = [' button', ' a', ' input', ' textarea', ' [role="button"]', ' [contenteditable="true"]']
  // 关键：NO_DRAG 里每个后代选择器都必须重复祖先，绝不能写成
  // "BAR button,BAR a,..." 那种把 BAR 单独留在列表里的形式 ——
  // 那会让 BAR 自己命中 no-drag，正是"品牌条拖不动"的原因。
  var NO_DRAG = []
  for (var i = 0; i < CLS.length; i++) {
    for (var j = 0; j < SEL.length; j++) NO_DRAG.push(CLS[i] + SEL[j])
  }

  var st = document.createElement('style')
  st.textContent =
    BARS + '{-webkit-app-region:drag;app-region:drag}' +
    NO_DRAG.join(',') + '{-webkit-app-region:no-drag;app-region:no-drag}' +
    '#dsh-traffic-lights{position:fixed;top:8px;left:8px;z-index:2147483647;display:flex;gap:8px;align-items:center;-webkit-app-region:no-drag;app-region:no-drag;user-select:none}' +
    '#dsh-traffic-lights button{width:12px;height:12px;border-radius:50%;border:1px solid rgba(0,0,0,.22);padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-app-region:no-drag;app-region:no-drag;outline:none}' +
    '#dsh-traffic-lights button svg{opacity:0;display:block;pointer-events:none}' +
    '#dsh-traffic-lights button:hover svg{opacity:.85}#dsh-traffic-lights button:hover{filter:brightness(.9)}'
  document.head.appendChild(st)

  var bar = document.createElement('div')
  bar.id = 'dsh-traffic-lights'
  var mk = function (c, svg, t, fn) {
    var b = document.createElement('button')
    b.type = 'button'
    b.title = t
    b.setAttribute('aria-label', t)
    b.style.background = c
    b.innerHTML = svg
    b.addEventListener('click', fn)
    bar.appendChild(b)
    return b
  }
  var a = ' stroke="rgba(0,0,0,.55)" stroke-width="1.1" stroke-linecap="round"'
  var v = ' viewBox="0 0 7 7"><path d="M'
  var xSvg = '<svg width="7" height="7"' + v + '1 1L6 6M6 1L1 6"' + a + '/></svg>'
  var mSvg = '<svg width="7" height="7"' + v + '1 3.5L6 3.5"' + a + '/></svg>'
  var eSvg = '<svg width="7" height="7"' + v + '2.5 .5H6.5V4.5M4.5 6.5H.5V2.5"' + a + ' fill="none"/></svg>'
  var rSvg = '<svg width="7" height="7"' + v + '.5 2.5H4.5V6.5M6.5 4.5H2.5V.5"' + a + ' fill="none"/></svg>'
  mk('#ff5f57', xSvg, '关闭', function () { window.dshWindow.close() })
  mk('#febc2e', mSvg, '最小化', function () { window.dshWindow.minimize() })
  var mb = mk('#28c840', eSvg, '最大化', function () { window.dshWindow.maximizeToggle() })
  var setMax = function (max) {
    mb.innerHTML = max ? rSvg : eSvg
    mb.title = max ? '还原' : '最大化'
    mb.setAttribute('aria-label', mb.title)
  }
  if (window.dshWindow.isMaximized) window.dshWindow.isMaximized().then(setMax).catch(function () {})
  if (window.dshWindow.onMaximizedChange) window.dshWindow.onMaximizedChange(setMax)
  document.body.appendChild(bar)
})()
