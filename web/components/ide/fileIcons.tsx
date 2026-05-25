import {
  File, FileCode2, FileText, FileArchive, Braces, Paintbrush2, Image as ImageIcon,
  Video, Music, TerminalSquare, Settings2, Database, Share2, Type, Lock, KeyRound,
  GitBranch, Container, Scale, BookOpen, Package, History, NotebookText, FileJson,
  Hash,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const EXT_ICON: Record<string, LucideIcon> = {
  // TypeScript / JavaScript
  ts: FileCode2, tsx: FileCode2, mts: FileCode2, cts: FileCode2,
  js: FileCode2, jsx: FileCode2, mjs: FileCode2, cjs: FileCode2,
  // Data / config
  json: Braces, jsonc: Braces, json5: Braces,
  yml: Settings2, yaml: Settings2, toml: Settings2, ini: Settings2, conf: Settings2,
  xml: FileCode2,
  // Markup
  md: FileText, mdx: FileText, markdown: FileText, txt: FileText, rst: FileText,
  pdf: FileText, log: FileText,
  // Web
  html: FileCode2, htm: FileCode2, vue: FileCode2, svelte: FileCode2, astro: FileCode2,
  // Styles
  css: Paintbrush2, scss: Paintbrush2, sass: Paintbrush2, less: Paintbrush2, styl: Paintbrush2,
  // Other languages
  py: FileCode2, rs: FileCode2, go: FileCode2, java: FileCode2, kt: FileCode2,
  swift: FileCode2, rb: FileCode2, php: FileCode2, c: FileCode2, h: FileCode2,
  cpp: FileCode2, cc: FileCode2, hpp: FileCode2, cs: FileCode2, lua: FileCode2,
  dart: FileCode2, ex: FileCode2, exs: FileCode2, erl: FileCode2, hs: FileCode2,
  scala: FileCode2, clj: FileCode2, r: FileCode2,
  // Shell
  sh: TerminalSquare, bash: TerminalSquare, zsh: TerminalSquare, fish: TerminalSquare,
  ps1: TerminalSquare, bat: TerminalSquare, cmd: TerminalSquare,
  // Data
  sql: Database, db: Database, sqlite: Database,
  graphql: Share2, gql: Share2, proto: Share2,
  csv: Hash, tsv: Hash,
  // Notebooks
  ipynb: NotebookText,
  // Images / media
  png: ImageIcon, jpg: ImageIcon, jpeg: ImageIcon, gif: ImageIcon, webp: ImageIcon,
  svg: ImageIcon, bmp: ImageIcon, ico: ImageIcon, avif: ImageIcon, tiff: ImageIcon,
  mp4: Video, mov: Video, webm: Video, avi: Video, mkv: Video, m4v: Video,
  mp3: Music, wav: Music, flac: Music, ogg: Music, m4a: Music, aac: Music,
  // Archive
  zip: FileArchive, tar: FileArchive, gz: FileArchive, tgz: FileArchive,
  rar: FileArchive, '7z': FileArchive, bz2: FileArchive, xz: FileArchive,
  // Fonts
  ttf: Type, otf: Type, woff: Type, woff2: Type, eot: Type,
  // Lock
  lock: Lock,
}

const NAME_ICON: Record<string, LucideIcon> = {
  'package.json': Package,
  'package-lock.json': Lock,
  'yarn.lock': Lock,
  'pnpm-lock.yaml': Lock,
  'bun.lockb': Lock,
  'bun.lock': Lock,
  'cargo.lock': Lock,
  'composer.lock': Lock,
  'gemfile.lock': Lock,
  'poetry.lock': Lock,
  'dockerfile': Container,
  '.dockerignore': Container,
  'docker-compose.yml': Container,
  'docker-compose.yaml': Container,
  '.gitignore': GitBranch,
  '.gitattributes': GitBranch,
  '.gitmodules': GitBranch,
  '.gitkeep': GitBranch,
  '.npmrc': Settings2,
  '.npmignore': Settings2,
  '.nvmrc': Settings2,
  '.editorconfig': Settings2,
  '.prettierrc': Settings2,
  '.prettierignore': Settings2,
  '.eslintrc': Settings2,
  '.eslintignore': Settings2,
  '.env': KeyRound,
  'license': Scale,
  'licence': Scale,
  'license.md': Scale,
  'license.txt': Scale,
}

const isReadme = (lower: string) => /^readme(\.|$)/.test(lower)
const isChangelog = (lower: string) => /^changelog(\.|$)/.test(lower) || /^history(\.|$)/.test(lower)
const isEnvFile = (lower: string) => lower === '.env' || lower.startsWith('.env.')
const isEslintConfig = (lower: string) => /^\.eslintrc(\..+)?$/.test(lower) || /^eslint\.config\./.test(lower)
const isPrettierConfig = (lower: string) => /^\.prettierrc(\..+)?$/.test(lower) || /^prettier\.config\./.test(lower)
const isTsConfig = (lower: string) => /^tsconfig(\..+)?\.json$/.test(lower)
const isViteLikeConfig = (lower: string) => /\.config\.(js|ts|mjs|cjs|mts|cts)$/.test(lower)
const isBabelConfig = (lower: string) => /^\.babelrc(\..+)?$/.test(lower) || /^babel\.config\./.test(lower)
const isJsonConfig = (lower: string) => lower === 'tsconfig.json' || lower.endsWith('.json')

export const getFileIconComponent = (name: string): LucideIcon => {
  const lower = name.toLowerCase()

  const direct = NAME_ICON[lower]
  if (direct) return direct

  if (isReadme(lower)) return BookOpen
  if (isChangelog(lower)) return History
  if (isEnvFile(lower)) return KeyRound
  if (isTsConfig(lower)) return Settings2
  if (isEslintConfig(lower)) return Settings2
  if (isPrettierConfig(lower)) return Settings2
  if (isBabelConfig(lower)) return Settings2
  if (isViteLikeConfig(lower)) return Settings2

  const dot = lower.lastIndexOf('.')
  if (dot > 0) {
    const ext = lower.slice(dot + 1)
    const mapped = EXT_ICON[ext]
    if (mapped) return mapped
    if (isJsonConfig(lower)) return FileJson
  }

  return File
}

interface FileTypeIconProps {
  name: string
  size?: number
  className?: string
}

export const FileTypeIcon = ({ name, size = 13, className }: FileTypeIconProps) => {
  const Icon = getFileIconComponent(name)
  return <Icon size={size} className={className} />
}
