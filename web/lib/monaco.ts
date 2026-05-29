/**
 * Monaco Editor
 *
 *  @monaco-editor/react  monaco-editor  CDN
 *  Monaco  import
 */
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

const { typescriptDefaults, javascriptDefaults } = monaco.languages.typescript
typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
})
javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true,
})

loader.config({ monaco })
