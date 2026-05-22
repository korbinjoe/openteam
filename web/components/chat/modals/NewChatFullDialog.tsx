/**
 * NewChatFullDialog —
 *
 *  + NewChatForm
 */

import { useTranslation } from 'react-i18next'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import NewChatForm from './NewChatForm'

interface NewChatFullDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentWorkspaceId?: string
  currentAgentId?: string | null
  routePrefix?: string
  chatSegment?: string
}

const NewChatFullDialog = ({ open, onOpenChange, currentWorkspaceId, currentAgentId, routePrefix, chatSegment }: NewChatFullDialogProps) => {
  const { t } = useTranslation(['workspace'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('workspace:newChat.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('workspace:newChat.desc')}</DialogDescription>
        </DialogHeader>

        <div className="mt-3">
          {open && (
            <NewChatForm
              currentWorkspaceId={currentWorkspaceId}
              currentAgentId={currentAgentId}
              onCreated={() => onOpenChange(false)}
              routePrefix={routePrefix}
              chatSegment={chatSegment}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default NewChatFullDialog
