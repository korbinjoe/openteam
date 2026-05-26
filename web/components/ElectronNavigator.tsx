/**
 * ElectronNavigator —  Electron
 *
 *  companion:navigate-to-chat  chat  workspaceId
 *  Electron
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, authFetch } from '@/config/api'
import { getChatTabActions } from '@/contexts/ChatTabContext'
import { buildMissionUrl } from '@/components/workspace/urls'

export const ElectronNavigator = () => {
  const navigate = useNavigate()

  useEffect(() => {
    const bridge = window.openteamBridge
    if (!bridge?.onNavigateToChat) return

    const unsubscribe = bridge.onNavigateToChat(async ({ chatId }) => {
      try {
        const res = await authFetch(`${API_BASE}/api/chats/${chatId}`)
        if (!res.ok) return
        const chat = await res.json() as { id: string; workspaceId: string; title: string }
        getChatTabActions()?.openTab(chat.id, chat.workspaceId, chat.title)
        navigate(buildMissionUrl(chat.workspaceId, chat.id))
      } catch { /* ignore */ }
    })

    return unsubscribe
  }, [navigate])

  return null
}
