import React from 'react'
import ReactDOM from 'react-dom/client'
import { TrayPanelApp } from './TrayPanelApp'
import '../index.css'

ReactDOM.createRoot(document.getElementById('tray-root')!).render(
  <React.StrictMode>
    <TrayPanelApp />
  </React.StrictMode>,
)
