'use strict'

/**
 * 自定义窗口控制（macOS 红绿灯）的 preload。
 * 通过 contextBridge 把窗口控制能力暴露给页面（主世界），
 * 页面注入的 window-controls.js 调用这些方法。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshWindow', {
  minimize: () => ipcRenderer.send('dsh:window-minimize'),
  maximizeToggle: () => ipcRenderer.send('dsh:window-maximize-toggle'),
  close: () => ipcRenderer.send('dsh:window-close'),
  isMaximized: () => ipcRenderer.invoke('dsh:window-is-maximized'),
  onMaximizedChange: (cb) => {
    const listener = (_e, value) => {
      try { cb(value) } catch { /* ignore listener errors */ }
    }
    ipcRenderer.on('dsh:window-maximized-changed', listener)
    return () => ipcRenderer.removeListener('dsh:window-maximized-changed', listener)
  },
})
