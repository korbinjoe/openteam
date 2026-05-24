// Placeholder titles assigned to a chat before the first user message.
// Includes the legacy English defaults plus every i18n translation of
// `workspace:newChat.title` ("New Mission") so the server-side auto-title
// trigger matches regardless of the user's locale at creation time.
export const PLACEHOLDER_TITLES: readonly string[] = [
  'New Chat',
  'New Session',
  'New Task',
  'New Mission',
  '新建任务',
  '新規タスク',
  '새 작업',
  'Nouvelle tâche',
  'Neue Aufgabe',
  'Nueva tarea',
  'Nova tarefa',
]

const PLACEHOLDER_SET = new Set(PLACEHOLDER_TITLES)

export const isPlaceholderTitle = (title: string | null | undefined): boolean => {
  if (!title) return true
  return PLACEHOLDER_SET.has(title.trim())
}
