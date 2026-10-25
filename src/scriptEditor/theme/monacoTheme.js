import * as monaco from 'monaco-editor';

export const MODERN_THEME = 'lmcc-modern';

let defined = false;

/**
 * Modern dark theme for Monaco: deep ink canvas, indigo/violet accents.
 * Defined once at import time so the editor can mount with it directly.
 */
export function applyModernTheme() {
  if (defined) return;

  monaco.editor.defineTheme(MODERN_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'd7dbec' },
      { token: 'comment', foreground: '626a86', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a78bfa' },
      { token: 'keyword.control', foreground: 'a78bfa' },
      { token: 'operator', foreground: '9aa1b9' },
      { token: 'delimiter', foreground: '7d86a8' },
      { token: 'string', foreground: '7fe7c4' },
      { token: 'number', foreground: 'f0a6ca' },
      { token: 'regexp', foreground: 'fbbf24' },
      { token: 'type', foreground: '7dd3fc' },
      { token: 'type.identifier', foreground: '7dd3fc' },
      { token: 'identifier', foreground: 'e8e9f3' },
      { token: 'function', foreground: 'c4b5fd' },
      { token: 'constant', foreground: 'fbbf24' },
      { token: 'annotation', foreground: 'fbbf24' },
      { token: 'tag', foreground: 'a78bfa' },
      { token: 'attribute.name', foreground: '7dd3fc' },
      { token: 'attribute.value', foreground: '7fe7c4' },
    ],
    colors: {
      'editor.background': '#0e0f16',
      'editor.foreground': '#d7dbec',
      'editorGutter.background': '#0e0f16',
      'editorLineNumber.foreground': '#3f4560',
      'editorLineNumber.activeForeground': '#a78bfa',
      'editorCursor.foreground': '#8b7bff',
      'editor.selectionBackground': '#7c6bff55',
      'editor.inactiveSelectionBackground': '#7c6bff26',
      'editor.selectionHighlightBackground': '#7c6bff22',
      'editor.wordHighlightBackground': '#a78bfa1f',
      'editor.wordHighlightStrongBackground': '#a78bfa2e',
      'editor.lineHighlightBackground': '#ffffff08',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#232637',
      'editorIndentGuide.activeBackground1': '#7c6bff66',
      'editorWhitespace.foreground': '#2a2e45',
      'editorBracketMatch.background': '#7c6bff22',
      'editorBracketMatch.border': '#7c6bff88',
      'editorWidget.background': '#141621',
      'editorWidget.border': '#2e3350',
      'editorSuggestWidget.background': '#141621',
      'editorSuggestWidget.border': '#2e3350',
      'editorSuggestWidget.selectedBackground': '#232743',
      'editorSuggestWidget.highlightForeground': '#a78bfa',
      'editorHoverWidget.background': '#141621',
      'editorHoverWidget.border': '#2e3350',
      'editorOverviewRuler.border': '#00000000',
      'minimap.background': '#0e0f16',
      'scrollbarSlider.background': '#7c6bff22',
      'scrollbarSlider.hoverBackground': '#7c6bff44',
      'scrollbarSlider.activeBackground': '#7c6bff66',
      'editor.findMatchBackground': '#7c6bff55',
      'editor.findMatchHighlightBackground': '#7c6bff2e',
      'editor.linkForeground': '#a78bfa',
      'editorError.foreground': '#fb7185',
      'editorWarning.foreground': '#fbbf24',
      'editorInfo.foreground': '#7dd3fc',
    },
  });

  defined = true;
}

applyModernTheme();
