import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import { ThemeProvider } from './contexts/ThemeContext'
import { NotificationProvider } from './contexts/NotificationContext'
import { ChatTabProvider } from './contexts/ChatTabContext'
import { AvatarStyleProvider } from './contexts/AvatarStyleContext'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App'
import { initModels } from './lib/models'
import './i18n'
import '@fontsource/nunito/700.css'
import '@fontsource/nunito/800.css'
import './index.css'
import './lib/aes'

const boot = async () => {
  await initModels()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <NotificationProvider>
          <ChatTabProvider>
            <AvatarStyleProvider>
            <TooltipProvider>
              <BrowserRouter>
                  <ErrorBoundary>
                    <App />
                  </ErrorBoundary>
              </BrowserRouter>
              <Toaster />
            </TooltipProvider>
            </AvatarStyleProvider>
          </ChatTabProvider>
        </NotificationProvider>
      </ThemeProvider>
    </React.StrictMode>,
  )
}

boot()
