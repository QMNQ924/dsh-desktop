(() => {
  // macOS 红绿灯风格窗口按钮：关闭 / 最小化 / 最大化（还原），固定在窗口左上角。
  if (document.getElementById('dsh-traffic-lights')) return
  if (!window.dshWindow) return // 仅在 Electron 壳内注入

  const style = document.createElement('style')
  style.textContent = `
    #dsh-traffic-lights{position:fixed;top:8px;left:8px;z-index:2147483647;display:flex;gap:8px;align-items:center;-webkit-app-region:no-drag;app-region:no-drag;user-select:none}
    #dsh-traffic-lights button{width:12px;height:12px;border-radius:50%;border:1px solid rgba(0,0,0,0.22);padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-app-region:no-drag;app-region:no-drag;outline:none}
    #dsh-traffic-lights button svg{opacity:0;display:block;pointer-events:none}
    #dsh-traffic-lights button:hover svg{opacity:0.85}
    #dsh-traffic-lights button:hover{filter:brightness(0.9)}
    #dsh-drag-strip{position:fixed;top:0;left:0;right:0;height:24px;z-index:2147483646;-webkit-app-region:drag;app-region:drag;cursor:default}
  `
  document.head.appendChild(style)

  const bar = document.createElement('div')
  bar.id = 'dsh-traffic-lights'

  const mkButton = (color, glyphSvg, title, action) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.title = title
    b.setAttribute('aria-label', title)
    b.style.background = color
    b.innerHTML = glyphSvg
    b.addEventListener('click', action)
    bar.appendChild(b)
    return b
  }

  const xSvg = '<svg width="7" height="7" viewBox="0 0 7 7"><path d="M1 1 L6 6 M6 1 L1 6" stroke="rgba(0,0,0,0.55)" stroke-width="1.1" stroke-linecap="round"/></svg>'
  const minusSvg = '<svg width="7" height="7" viewBox="0 0 7 7"><path d="M1 3.5 L6 3.5" stroke="rgba(0,0,0,0.55)" stroke-width="1.1" stroke-linecap="round"/></svg>'
  const expandSvg = '<svg width="7" height="7" viewBox="0 0 7 7"><path d="M2.5 0.5 H6.5 V4.5 M4.5 6.5 H0.5 V2.5" stroke="rgba(0,0,0,0.55)" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>'
  const restoreSvg = '<svg width="7" height="7" viewBox="0 0 7 7"><path d="M0.5 2.5 H4.5 V6.5 M6.5 4.5 H2.5 V0.5" stroke="rgba(0,0,0,0.55)" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>'

  mkButton('#ff5f57', xSvg, '关闭', () => { if (window.dshWindow) window.dshWindow.close() })
  mkButton('#febc2e', minusSvg, '最小化', () => { if (window.dshWindow) window.dshWindow.minimize() })
  const maxBtn = mkButton('#28c840', expandSvg, '最大化', () => { if (window.dshWindow) window.dshWindow.maximizeToggle() })

  const setMaximized = (max) => {
    maxBtn.innerHTML = max ? restoreSvg : expandSvg
    maxBtn.title = max ? '还原' : '最大化'
    maxBtn.setAttribute('aria-label', maxBtn.title)
  }
  if (window.dshWindow.isMaximized) {
    window.dshWindow.isMaximized().then(setMaximized).catch(() => {})
  }
  if (window.dshWindow.onMaximizedChange) {
    window.dshWindow.onMaximizedChange(setMaximized)
  }

  document.body.appendChild(bar)
})()
