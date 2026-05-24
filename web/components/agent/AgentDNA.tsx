/**
 * AgentDNA — Agent
 *  MemorySkill GrowthPerformance Metrics
 */

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Brain, TrendingUp, TrendingDown, Minus, Zap, BookOpen } from 'lucide-react'
import type { AgentDNA as AgentDNAType, AgentSkill, AgentMetrics } from '../../types/team'

interface AgentDNAProps {
  dna: AgentDNAType
}

const AgentDNA = ({ dna }: AgentDNAProps) => {
  const { t } = useTranslation('agents')

  return (
    <div className="space-y-5">
      <section>
        <SectionHeader icon={<Zap size={12} />} title={t('dna.expertise')} />
        <div className="space-y-2 mt-2">
          {dna.skills.map((skill) => (
            <SkillBar key={skill.name} skill={skill} />
          ))}
          {dna.skills.length === 0 && (
            <div className="text-xs text-text-secondary py-2">{t('dna.learningHint')}</div>
          )}
        </div>
      </section>

      <section>
        <SectionHeader icon={<TrendingUp size={12} />} title={t('dna.performance')} />
        <MetricsGrid metrics={dna.metrics} />
      </section>

      <section>
        <SectionHeader icon={<Brain size={12} />} title={t('dna.memory')} />
        <MemorySummary />
      </section>
    </div>
  )
}

/* -- Section Header ---------------------------------------- */

const SectionHeader = ({ icon, title }: { icon: React.ReactNode; title: string }) => (
  <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">
    {icon}
    {title}
  </div>
)

/* -- Skill Bar --------------------------------------------- */

const SkillBar = ({ skill }: { skill: AgentSkill }) => {
  const { t } = useTranslation('agents')

  const progress = skill.maxLevel > 0
    ? ((skill.level + (skill.missionCount / Math.max(skill.missionsToNextLevel, 1))) / skill.maxLevel) * 100
    : 0
  const clampedProgress = Math.min(progress, 100)

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs text-text-primary">{skill.name}</span>
        <span className="text-xs text-text-secondary">
          {skill.level >= skill.maxLevel ? t('dna.mastered') : `Lv.${skill.level}`}
          {skill.level < skill.maxLevel && <span className="text-text-muted/50">/{skill.maxLevel}</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-hover-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            skill.level >= skill.maxLevel ? 'bg-accent-green' : 'bg-accent-brand',
          )}
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
      <div className="text-xs text-text-secondary mt-0.5">
        {t('dna.missionCompleted', { count: skill.missionCount })}
        {skill.level < skill.maxLevel && ` · ${t('dna.missionsToUpgrade', { count: skill.missionsToNextLevel - skill.missionCount })}`}
      </div>
    </div>
  )
}

/* -- Metrics Grid ------------------------------------------ */

const MetricsGrid = ({ metrics }: { metrics: AgentMetrics }) => {
  const { t } = useTranslation('agents')

  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      <MetricCard
        label={t('dna.successRate')}
        value={`${Math.round(metrics.successRate * 100)}%`}
        trend={getTrend(metrics.successRate, metrics.prevSuccessRate)}
      />
      <MetricCard
        label={t('dna.firstPassRate')}
        value={`${Math.round(metrics.firstPassRate * 100)}%`}
        trend={getTrend(metrics.firstPassRate, metrics.prevFirstPassRate)}
      />
      <MetricCard
        label={t('dna.avgDuration')}
        value={formatDuration(metrics.avgDurationMs)}
        trend={getDurationTrend(metrics.avgDurationMs, metrics.prevAvgDurationMs)}
      />
      <MetricCard
        label={t('dna.qualityScore')}
        value={metrics.qualityScore}
      />
      <MetricCard
        label={t('dna.totalTasks')}
        value={String(metrics.totalTasks)}
        fullWidth
      />
    </div>
  )
}

type TrendDir = 'up' | 'down' | 'flat'

const getTrend = (current: number, prev?: number): TrendDir | undefined => {
  if (prev == null) return undefined
  if (current > prev) return 'up'
  if (current < prev) return 'down'
  return 'flat'
}

const getDurationTrend = (current: number, prev?: number): TrendDir | undefined => {
  if (prev == null) return undefined
  // For duration, lower is better
  if (current < prev) return 'up'
  if (current > prev) return 'down'
  return 'flat'
}

const MetricCard = ({ label, value, trend, fullWidth }: {
  label: string
  value: string
  trend?: TrendDir
  fullWidth?: boolean
}) => (
  <div className={cn(
    'bg-bg-hover-subtle rounded-md px-2.5 py-2 border border-border-subtle',
    fullWidth && 'col-span-2',
  )}>
    <div className="text-xs text-text-secondary mb-0.5">{label}</div>
    <div className="flex items-center gap-1">
      <span className="text-[14px] font-semibold text-text-emphasis">{value}</span>
      {trend && <TrendIcon trend={trend} />}
    </div>
  </div>
)

const TrendIcon = ({ trend }: { trend: TrendDir }) => {
  if (trend === 'up') return <TrendingUp size={11} className="text-accent-green" />
  if (trend === 'down') return <TrendingDown size={11} className="text-accent-red" />
  return <Minus size={11} className="text-text-secondary" />
}

/* -- Memory Summary ---------------------------------------- */

const MemorySummary = () => {
  const { t } = useTranslation('agents')

  return (
    <div className="mt-2 space-y-1.5">
      <MemoryRow
        icon={<BookOpen size={10} />}
        label={t('dna.shortTermMemory')}
        desc={t('dna.shortTermDesc')}
        count={0}
      />
      <MemoryRow
        icon={<Brain size={10} />}
        label={t('dna.longTermMemory')}
        desc={t('dna.longTermDesc')}
        count={0}
      />
      <MemoryRow
        icon={<Zap size={10} />}
        label={t('dna.sharedMemory')}
        desc={t('dna.sharedDesc')}
        count={0}
      />
    </div>
  )
}

const MemoryRow = ({ icon, label, desc, count }: {
  icon: React.ReactNode
  label: string
  desc: string
  count: number
}) => {
  const { t } = useTranslation('agents')

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg-hover-subtle">
      <span className="text-text-secondary shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-primary">{label}</div>
        <div className="text-xs text-text-secondary">{desc}</div>
      </div>
      <span className="text-xs text-text-secondary shrink-0">{t('dna.memoryCount', { count })}</span>
    </div>
  )
}

/* -- Helpers ----------------------------------------------- */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

export default AgentDNA
