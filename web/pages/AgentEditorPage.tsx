import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft, Save, Copy, Sparkles, Wand2, Users, Image as ImageIcon,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import AgentAvatar from '@/components/ui/agent-avatar'
import SenseiDiffDialog from '@/components/agent/SenseiDiffDialog'
import { isElectron, ELECTRON_TITLEBAR_PADDING } from '../utils/env'
import { Section } from '@/components/agent/Section'
import IdentityFormPanel from '@/components/agent/IdentityFormPanel'
import AgentMarkdownSplitEditor from '@/components/agent/AgentMarkdownSplitEditor'
import { FileIcon, MetricCard } from '@/components/agent/AgentEditorDecor'
import AgentExamplesPanel from '@/components/agent/AgentExamplesPanel'
import useAgentEditor, {
  parseIdentityContent,
  serializeIdentityFromParsed,
  getIdentityParseWarnings,
  type AgentNewEditLocationState,
  AGENT_NEW_OPEN_AI_GENERATE_STATE_KEY,
  type EditorTab,
} from '../hooks/useAgentEditor'
import useAgentDNA from '../hooks/useAgentDNA'
import useSenseiUpgrade from '../hooks/useSenseiUpgrade'
import useSenseiUpgradeFull, { type FullSuiteState } from '../hooks/useSenseiUpgradeFull'
import { generateAvatar } from '@/services/agentApi'
import { useIdentitySplitPane } from '../hooks/useIdentitySplitPane'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const FILE_TABS: { key: EditorTab; lang: string }[] = [
  { key: 'IDENTITY.md', lang: 'yaml' },
  { key: 'AGENTS.md', lang: 'markdown' },
  { key: 'SOUL.md', lang: 'markdown' },
]

const FILE_HINT_KEYS: Record<EditorTab, string> = {
  'IDENTITY.md': 'agents:editor.fileHints.identity',
  'AGENTS.md': 'agents:editor.fileHints.agents',
  'SOUL.md': 'agents:editor.fileHints.soul',
}

type GenerateRange = 'full-suite' | 'avatar-only'

const RANGE_OPTION_KEYS: Array<{ value: GenerateRange; labelKey: string; descKey: string }> = [
  { value: 'full-suite',  labelKey: 'agents:editor.generate.fullSuite',   descKey: 'agents:editor.generate.fullSuiteDesc' },
  { value: 'avatar-only', labelKey: 'agents:editor.generate.avatarOnly', descKey: 'agents:editor.generate.avatarOnlyDesc' },
]

const parseNameAnimal = (identityMd: string) => {
  const parsed = parseIdentityContent(identityMd)
  return { name: parsed.name?.trim() || '', animal: parsed.animal?.trim() || '' }
}

const AGENTS_BASE = '/agents'

const AgentEditorPage = () => {
  const { t } = useTranslation(['agents'])
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const {
    agent, loading, saving, dirty, isNew, isReadonly,
    identityMd, agentsMd, soulMd,
    updateIdentityMd, updateAgentsMd, updateSoulMd,
    activeTab, setActiveTab,
    cloneModalOpen, cloneName, setCloneModalOpen, setCloneName,
    handleSave, handleClone, handleOpenCloneModal,
    hireTeamPrompt, hireTeamSubmitting, dismissHireTeamDialog, confirmHireTeam,
  } = useAgentEditor()
  const [avatarVersion, setAvatarVersion] = useState(0)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [generateDescription, setGenerateDescription] = useState('')
  const [generateRange, setGenerateRange] = useState<GenerateRange>('full-suite')
  const [confirmFullOpen, setConfirmFullOpen] = useState(false)
  const [confirmUpgradeOpen, setConfirmUpgradeOpen] = useState(false)
  const recruitAiGenerateOpenedRef = useRef(false)

  useEffect(() => {
    if (!isNew) recruitAiGenerateOpenedRef.current = false
  }, [isNew])

  const { dna } = useAgentDNA(isNew ? undefined : id)
  const sensei = useSenseiUpgrade(id, agentsMd, updateAgentsMd)

  const currentSuite = useMemo<FullSuiteState>(
    () => ({ identity: identityMd, agents: agentsMd, soul: soulMd }),
    [identityMd, agentsMd, soulMd],
  )
  const applySuite = (next: FullSuiteState) => {
    if (next.identity) updateIdentityMd(next.identity)
    if (next.agents)   updateAgentsMd(next.agents)
    if (next.soul)     updateSoulMd(next.soul)
  }
  const senseiFull = useSenseiUpgradeFull(agent.id || undefined, currentSuite, applySuite)

  /**  name/animal  ref generateAvatar */
  const pendingAvatarRef = useRef<{ name: string; animal: string } | null>(null)

  const triggerAvatarGeneration = useCallback(async (agentId: string, params: { name: string; animal: string }) => {
    const result = await generateAvatar(agentId, params)
    if (!result) return
    if (result.succeeded > 0) {
      setAvatarVersion((v) => v + 1)
      toast.success(t('agents:editor.toast.avatarDone', { succeeded: result.succeeded, total: result.succeeded + result.failed }))
    } else {
      const firstErr = result.errors?.[0]?.reason
      toast.error(t('agents:editor.toast.avatarFailed', { reason: firstErr ? `: ${firstErr}` : '' }))
    }
  }, [])

  const { splitContainerRef, leftPx, gutterPx, gutterProps } = useIdentitySplitPane({
    disabled: isReadonly,
  })

  const parsedIdentity = useMemo(() => parseIdentityContent(identityMd), [identityMd])
  const identityParseWarnings = useMemo(() => {
    if (activeTab !== 'IDENTITY.md') return []
    return getIdentityParseWarnings(identityMd)
  }, [activeTab, identityMd])

  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== 's' && e.key !== 'S')) return
      e.preventDefault()
      if (loading || saving) return
      if (!dirty && !isNew) return
      if (isReadonly) return
      void doSave()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dirty, isNew, isReadonly, loading, saving])

  const doSave = async () => {
    const result = await handleSaveRef.current()
    if (!result) return
    const pending = pendingAvatarRef.current
    if (pending && pending.name && pending.animal) {
      pendingAvatarRef.current = null
      toast.info(t('agents:editor.toast.avatarGenerating'))
      void triggerAvatarGeneration(result.id, pending)
    }
  }

  useEffect(() => {
    if (!isNew || loading || recruitAiGenerateOpenedRef.current) return
    const st = location.state as AgentNewEditLocationState | null
    if (!st?.[AGENT_NEW_OPEN_AI_GENERATE_STATE_KEY]) return
    recruitAiGenerateOpenedRef.current = true
    setGenerateDialogOpen(true)
    navigate(`${AGENTS_BASE}/new/edit`, { replace: true, state: {} })
  }, [isNew, loading, location.state, navigate])

  const launchAvatarOnly = () => {
    const { name, animal } = parseNameAnimal(identityMd)
    if (!name || !animal) {
      toast.error(t('agents:editor.toast.needNameAnimal'))
      return
    }
    if (!agent.id) {
      toast.error(t('agents:editor.toast.needSaveFirst'))
      return
    }
    toast.info(t('agents:editor.toast.avatarBackground'))
    void triggerAvatarGeneration(agent.id, { name, animal })
  }

  const handleGenerateConfirm = async () => {
    if (generateRange === 'avatar-only') {
      setGenerateDialogOpen(false)
      launchAvatarOnly()
      return
    }

    if (!generateDescription.trim()) return

    await runGenerate()
  }

  const runGenerate = async () => {
    setGenerateDialogOpen(false)
    setConfirmFullOpen(false)
    await senseiFull.generate(generateDescription)
  }

  const performFullSuiteApply = () => {
    setConfirmFullOpen(false)
    const next = senseiFull.optimized
    senseiFull.apply()
    if (next.identity) {
      const { name, animal } = parseNameAnimal(next.identity)
      if (name && animal) pendingAvatarRef.current = { name, animal }
    }
    if (isNew) {
      toast.info(t('agents:editor.toast.applied'))
    }
  }

  const handleOpenUpgradeConfirm = () => {
    if (!agent.id) {
      toast.error(t('agents:editor.toast.upgradeNoId'))
      return
    }
    if (!agentsMd.trim()) {
      toast.error(t('agents:editor.toast.upgradeNoContent'))
      return
    }
    setConfirmUpgradeOpen(true)
  }

  /**  sensei.launchhook  toast */
  const handleConfirmUpgrade = async () => {
    setConfirmUpgradeOpen(false)
    const reason = await sensei.launch()
    if (reason) toast.error(reason)
  }

  const handleFullApply = () => {
    if (!isNew) {
      setConfirmFullOpen(true)
      return
    }
    performFullSuiteApply()
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-secondary">
        Loading...
      </div>
    )
  }

  const contentMap: Record<EditorTab, string> = {
    'IDENTITY.md': identityMd,
    'AGENTS.md': agentsMd,
    'SOUL.md': soulMd,
  }
  const updateMap: Record<EditorTab, (v: string) => void> = {
    'IDENTITY.md': updateIdentityMd,
    'AGENTS.md': updateAgentsMd,
    'SOUL.md': updateSoulMd,
  }

  const activeBusy = sensei.status === 'analyzing' || senseiFull.status === 'analyzing'

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3.5 h-10 border-b border-border-subtle shrink-0"
        style={{
          paddingLeft: isElectron ? ELECTRON_TITLEBAR_PADDING : 14,
          ...(isElectron ? { WebkitAppRegion: 'drag' } : {}),
        } as React.CSSProperties}
      >
        <button
          onClick={() => navigate(AGENTS_BASE)}
          aria-label="Back to agents"
          className="p-1 flex items-center rounded-sm text-text-secondary hover:text-text-primary transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <ArrowLeft size={16} />
        </button>
        <AgentAvatar name={agent.name || 'new'} agentId={agent.id} size="sm" version={avatarVersion} />
        <span className="text-[13px] font-semibold text-text-emphasis">
          {isNew ? 'New Agent' : agent.name}
        </span>
        {isReadonly && (
          <span className="text-xs px-1.5 py-px rounded bg-[rgba(250,173,20,0.12)] text-[#faad14]">
            Read-only
          </span>
        )}
        {dirty && <span className="text-xs text-accent-brand">Unsaved</span>}
        <span className="flex-1" />

        <div className="flex gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {isNew && (
            <button
              onClick={() => setGenerateDialogOpen(true)}
              disabled={activeBusy}
              className="inline-flex items-center gap-1 rounded border border-accent-brand/50 bg-accent-brand/10 px-2.5 py-1 text-xs text-accent-brand hover:bg-accent-brand/20 transition-colors disabled:opacity-50"
            >
              <Wand2 size={12} />
              {activeBusy ? t('agents:editor.generating') : t('agents:editor.aiGenerate')}
            </button>
          )}
          {!isReadonly && !isNew && (
            <>
              <button
                onClick={() => setGenerateDialogOpen(true)}
                disabled={activeBusy}
                className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text-primary hover:bg-bg-hover-muted transition-colors disabled:opacity-50"
              >
                <Sparkles size={12} />
                {activeBusy ? t('agents:editor.generating') : t('agents:editor.aiRegenerate')}
              </button>
              <button
                onClick={handleOpenUpgradeConfirm}
                disabled={activeBusy}
                className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text-primary hover:bg-bg-hover-muted transition-colors disabled:opacity-50"
              >
                <Sparkles size={12} />
                {t('agents:editor.upgrade')}
              </button>
            </>
          )}
          {isReadonly && (
            <button
              onClick={handleOpenCloneModal}
              className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text-primary hover:bg-bg-hover-muted transition-colors"
            >
              <Copy size={12} />
              Clone to Edit
            </button>
          )}
          {!isReadonly && (
            <button
              onClick={() => void doSave()}
              disabled={saving || (!dirty && !isNew)}
              className="inline-flex items-center gap-1 rounded bg-accent-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={12} />
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">
        {/* Editor area */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* File tabs (WebIDE style) */}
          <div className="flex border-b border-border-subtle shrink-0 bg-bg-secondary">
            {FILE_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-mono border-r border-border-subtle transition-colors ${
                  activeTab === tab.key
                    ? 'bg-bg-primary text-text-primary border-t-2 border-t-accent-brand -mt-px'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover-muted'
                }`}
              >
                <FileIcon filename={tab.key} active={activeTab === tab.key} />
                {tab.key}
              </button>
            ))}
          </div>

          {/* File hint */}
          <div className="shrink-0 px-4 py-1.5 text-[11px] text-text-secondary bg-bg-secondary border-b border-border-subtle font-mono">
            {t(FILE_HINT_KEYS[activeTab])}
          </div>

          {activeTab === 'IDENTITY.md' && identityParseWarnings.length > 0 && (
            <div className="shrink-0 px-4 py-1.5 text-[11px] text-amber-600 dark:text-amber-400/95 bg-amber-500/10 border-b border-border-subtle space-y-0.5">
              {identityParseWarnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
            {activeTab === 'IDENTITY.md' ? (
              <div
                ref={splitContainerRef}
                className="flex flex-1 min-h-0 w-full min-w-0 flex-row overflow-x-auto"
              >
                <div
                  style={{ width: leftPx }}
                  className="flex min-h-0 shrink-0 flex-col border-r border-border-subtle bg-bg-primary"
                >
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <IdentityFormPanel
                      value={parsedIdentity}
                      onChange={(next) => updateIdentityMd(serializeIdentityFromParsed(next))}
                      disabled={isReadonly}
                    />
                  </div>
                </div>
                <div
                  {...gutterProps}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('agents:editor.dragResize')}
                  style={{ width: gutterPx }}
                  className={cn(
                    'shrink-0 cursor-col-resize select-none touch-none bg-border-subtle hover:bg-accent-brand/25',
                    'border-x border-border-subtle',
                  )}
                />
                <div className="flex min-h-0 min-w-[200px] flex-1 flex-col">
                  <textarea
                    value={identityMd}
                    onChange={(e) => updateIdentityMd(e.target.value)}
                    disabled={isReadonly}
                    spellCheck={false}
                    className="min-h-0 flex-1 w-full resize-none bg-bg-primary px-5 py-4 text-xs text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-70 disabled:cursor-not-allowed leading-relaxed"
                    style={{
                      fontFamily: "'SF Mono', 'Consolas', 'Monaco', monospace",
                      fontSize: 12,
                      tabSize: 2,
                    }}
                  />
                </div>
                {!isReadonly && (
                  <div className="w-[25vw] shrink-0 border-l border-border-subtle flex min-h-0 flex-col overflow-hidden">
                    <AgentExamplesPanel tab="IDENTITY.md" onApply={updateIdentityMd} />
                  </div>
                )}
              </div>
            ) : activeTab === 'AGENTS.md' || activeTab === 'SOUL.md' ? (
              <AgentMarkdownSplitEditor
                tab={activeTab}
                value={contentMap[activeTab]}
                onChange={updateMap[activeTab]}
                disabled={isReadonly}
              />
            ) : null}
          </div>

          {/* Readonly footer */}
          {isReadonly && (
            <div className="shrink-0 m-4 p-4 rounded-lg border border-dashed border-[rgba(250,173,20,0.3)] bg-[rgba(250,173,20,0.04)] text-center">
              <div className="text-xs text-[#faad14] mb-2">Built-in agents are read-only</div>
              <button
                onClick={handleOpenCloneModal}
                className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover-muted transition-colors"
              >
                <Copy size={12} />
                Clone to Edit
              </button>
            </div>
          )}
        </div>

        {/* Right: Growth Profile */}
        {!isNew && (
        <div className="w-[260px] shrink-0 border-l border-border-subtle overflow-y-auto p-4">
          <Section title={t('agents:editor.growthRecord')}>
                {dna && dna.metrics.totalTasks > 0 ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <MetricCard label={t('agents:editor.totalTasks')} value={String(dna.metrics.totalTasks)} />
                      <MetricCard label={t('agents:editor.successRate')} value={`${Math.round(dna.metrics.successRate * 100)}%`} />
                      <MetricCard label={t('agents:editor.firstPass')} value={`${Math.round(dna.metrics.firstPassRate * 100)}%`} />
                      <MetricCard label={t('agents:editor.quality')} value={dna.metrics.qualityScore} />
                    </div>
                    {dna.skills.length > 0 && (
                      <div className="space-y-1.5 mt-3">
                        {dna.skills.map((skill) => (
                          <div key={skill.name} className="flex items-center gap-2 text-xs">
                            <span className="text-text-primary w-16 truncate text-xs">{skill.name}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-bg-primary overflow-hidden">
                              <div
                                className="h-full rounded-full bg-accent-brand"
                                style={{ width: `${Math.min(skill.level * 20, 100)}%` }}
                              />
                            </div>
                            <span className="text-text-secondary text-xs w-6 text-right">Lv.{skill.level}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="text-xs text-text-secondary">
                      {t('agents:editor.growthHint')}
                    </div>
                  </div>
                )}
          </Section>
        </div>
        )}
      </div>

      {/* Clone Dialog */}
      <Dialog open={cloneModalOpen} onOpenChange={setCloneModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone &quot;{agent.name}&quot;</DialogTitle>
            <DialogDescription>Enter a new name for the cloned agent.</DialogDescription>
          </DialogHeader>
          <div className="mt-3">
            <label className="text-xs text-text-secondary block mb-1">New Agent Name</label>
            <input
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              placeholder="Enter new name"
              onKeyDown={(e) => { if (e.key === 'Enter') handleClone() }}
              className="w-full rounded-md border border-border bg-bg-input px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-brand"
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => setCloneModalOpen(false)}
              className="rounded px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleClone}
              disabled={!cloneName.trim()}
              className="rounded bg-accent-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clone
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI GenerateDescriptionInput */}
      <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 size={14} className="text-accent-brand" />
              {t('agents:editor.generateTitle')}
            </DialogTitle>
            <DialogDescription>
              {isNew
                ? t('agents:editor.generateDescNew')
                : t('agents:editor.generateDescEdit')}
            </DialogDescription>
          </DialogHeader>

          {!isNew && (
            <div className="mt-2 space-y-1.5">
              <label className="text-xs text-text-secondary block">{t('agents:editor.generateScope')}</label>
              <div className="flex flex-col gap-1">
                {RANGE_OPTION_KEYS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      'flex items-start gap-2 rounded border px-2.5 py-2 cursor-pointer transition-colors',
                      generateRange === opt.value
                        ? 'border-accent-brand bg-accent-brand/5'
                        : 'border-border hover:bg-bg-hover-muted',
                    )}
                  >
                    <input
                      type="radio"
                      name="gen-range"
                      value={opt.value}
                      checked={generateRange === opt.value}
                      onChange={() => setGenerateRange(opt.value)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1 text-xs text-text-primary">
                        {opt.value === 'avatar-only' && <ImageIcon size={11} className="text-text-secondary" />}
                        {t(opt.labelKey)}
                      </div>
                      <div className="text-[11px] text-text-secondary">{t(opt.descKey)}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {generateRange !== 'avatar-only' && (
            <div className="mt-3">
              <textarea
                value={generateDescription}
                onChange={(e) => setGenerateDescription(e.target.value)}
                placeholder={t('agents:editor.descriptionPlaceholder')}
                rows={4}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerateConfirm() }}
                className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-brand resize-none"
              />
              <div className="text-xs text-text-secondary mt-1">{t('agents:editor.quickGenerate')}</div>
            </div>
          )}

          {generateRange === 'avatar-only' && (
            <div className="mt-3 text-xs text-text-secondary" dangerouslySetInnerHTML={{ __html: t('agents:editor.avatarOnlyHint') }} />
          )}

          <DialogFooter>
            <button
              onClick={() => setGenerateDialogOpen(false)}
              className="rounded px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              {t('agents:editor.cancel')}
            </button>
            <button
              onClick={handleGenerateConfirm}
              disabled={generateRange !== 'avatar-only' && !generateDescription.trim()}
              className="inline-flex items-center gap-1 rounded bg-accent-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Wand2 size={11} />
              {generateRange === 'avatar-only' ? t('agents:editor.backgroundGenerate') : t('agents:editor.generate')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmUpgradeOpen} onOpenChange={setConfirmUpgradeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={14} className="text-accent-brand" />
              {t('agents:editor.upgradeConfirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('agents:editor.upgradeConfirmDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmUpgradeOpen(false)}
              className="rounded px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              {t('agents:editor.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmUpgrade()}
              className="inline-flex items-center gap-1 rounded bg-accent-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              <Sparkles size={12} />
              {t('agents:editor.confirmUpgrade')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmFullOpen} onOpenChange={setConfirmFullOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('agents:editor.overwriteTitle')}</DialogTitle>
            <DialogDescription>
              {t('agents:editor.overwriteDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setConfirmFullOpen(false)}
              className="rounded px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              {t('agents:editor.cancel')}
            </button>
            <button
              type="button"
              onClick={performFullSuiteApply}
              className="rounded bg-accent-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              {t('agents:editor.confirmOverwrite')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!hireTeamPrompt}
        onOpenChange={(open) => { if (!open) dismissHireTeamDialog() }}
      >
        <DialogContent className="duration-300">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users size={14} className="text-accent-brand" />
              {t('agents:editorHire.title')}
            </DialogTitle>
            <DialogDescription>
              {t('agents:editorHire.desc', { name: hireTeamPrompt?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              disabled={hireTeamSubmitting}
              onClick={dismissHireTeamDialog}
              className="rounded px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
            >
              {t('agents:editorHire.dismiss')}
            </button>
            <button
              type="button"
              disabled={hireTeamSubmitting}
              onClick={() => void confirmHireTeam()}
              className="inline-flex items-center gap-1 rounded bg-accent-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {hireTeamSubmitting ? t('agents:editorHire.submitting') : t('agents:editorHire.confirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!isNew && sensei.status !== 'idle' && (
        <SenseiDiffDialog
          status={sensei.status}
          logs={sensei.logs}
          original={sensei.original}
          optimized={sensei.optimized}
          error={sensei.error}
          onApply={sensei.apply}
          onCancel={sensei.cancel}
          onDismiss={sensei.dismiss}
          agentName={agent.name || t('agents:editor.newAgent')}
          mode="upgrade"
        />
      )}

      {senseiFull.status !== 'idle' && (
        <SenseiDiffDialog
          mode="full-suite"
          isNew={isNew}
          status={senseiFull.status}
          logs={senseiFull.logs}
          current={currentSuite}
          optimized={senseiFull.optimized}
          partialError={senseiFull.partialError}
          error={senseiFull.error}
          onApply={handleFullApply}
          onRetrySegment={senseiFull.retrySegment}
          onCancel={senseiFull.cancel}
          onDismiss={senseiFull.dismiss}
          agentName={agent.name || t('agents:editor.newAgent')}
        />
      )}
    </div>
  )
}

export default AgentEditorPage
