import { useEffect, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'
import { type ConfigFile } from './api'
import { parseConfigFromText } from './api'
import { serializeConfigToText } from './configUtils'
import './RawEditorTab.css'

interface Props {
  config: ConfigFile
  onUpdate: (updater: (c: ConfigFile) => ConfigFile) => void
  onTestSyntax: () => void
  readOnly?: boolean
}

const darkTheme = EditorView.theme({
  '&': {
    background: '#0d1117',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    height: '100%',
  },
  '.cm-content': {
    caretColor: '#93c5fd',
    padding: '12px 0',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-cursor': {
    borderLeftColor: '#93c5fd',
  },
  '.cm-gutters': {
    background: '#111827',
    color: '#475569',
    border: 'none',
    borderRight: '1px solid #1e293b',
  },
  '.cm-activeLineGutter': {
    background: '#1a2236',
  },
  '.cm-activeLine': {
    background: '#1a223640',
  },
  '.cm-selectionBackground, ::selection': {
    background: '#1d4ed840',
  },
  '.cm-focused .cm-selectionBackground': {
    background: '#1d4ed840',
  },
}, { dark: true })

export default function RawEditorTab({ config, onUpdate, onTestSyntax, readOnly }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applySuccess, setApplySuccess] = useState(false)

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current) return

    const text = serializeConfigToText(config)

    const state = EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        StreamLanguage.define(nginx),
        darkTheme,
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly ?? false),
      ],
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // We intentionally only init once - config updates handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When config changes externally (e.g. undo/redo), sync text if view exists
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const newText = serializeConfigToText(config)
    const currentText = view.state.doc.toString()
    if (newText !== currentText) {
      view.dispatch({
        changes: { from: 0, to: currentText.length, insert: newText },
      })
    }
  }, [config])

  const handleApply = async () => {
    const view = viewRef.current
    if (!view) return
    const text = view.state.doc.toString()
    setApplying(true)
    setApplyError(null)
    setApplySuccess(false)
    try {
      const parsed = await parseConfigFromText(text)
      onUpdate(() => parsed)
      setApplySuccess(true)
      setTimeout(() => setApplySuccess(false), 2500)
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : 'Parse failed')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="raw-editor-tab">
      <div className="raw-editor-banner">
        <span className="raw-editor-warning-icon">⚠</span>
        Editing raw text bypasses structured validation. Use "Apply" to update the structured editor.
      </div>

      <div className="raw-editor-toolbar">
        {!readOnly && (
          <button
            type="button"
            className="btn-save"
            onClick={handleApply}
            disabled={applying}
          >
            {applying ? 'Parsing…' : 'Apply Raw Changes'}
          </button>
        )}
        <button
          type="button"
          className="btn-global"
          onClick={onTestSyntax}
        >
          Test Syntax
        </button>
        {applySuccess && <span className="raw-editor-success">Applied successfully</span>}
        {applyError && <span className="raw-editor-error">{applyError}</span>}
      </div>

      <div className="raw-editor-codemirror" ref={editorRef} />
    </div>
  )
}
