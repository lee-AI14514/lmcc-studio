import * as monaco from 'monaco-editor';

export const LMCC_LANGUAGE_ID = 'lmcc';

let registered = false;

/**
 * Register a tiny Monarch grammar for `.lmcc` files: the `LMCC/1` header plus
 * JSON tokens. It is registered once and then reused by every editor model.
 */
export function registerLmccLanguage() {
  if (registered) return;
  registered = true;

  monaco.languages.register({
    id: LMCC_LANGUAGE_ID,
    extensions: ['.lmcc'],
    aliases: ['LMCC', 'lmcc'],
    mimetypes: ['application/x-lmcc'],
  });

  monaco.languages.setLanguageConfiguration(LMCC_LANGUAGE_ID, {
    comments: {},
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider(LMCC_LANGUAGE_ID, {
    defaultToken: '',
    tokenPostfix: '.lmcc',
    tokenizer: {
      root: [
        [/^\uFEFF/, ''],
        [/LMCC\/\d+/, 'keyword'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/[{}[\],:]/, 'delimiter'],
        [/\s+/, ''],
        [/./, 'invalid'],
      ],
    },
  });
}

/**
 * Keep the previous editor behaviour for ordinary files while giving `.lmcc`
 * documents a dedicated grammar.
 */
export function languageForPath(filePath) {
  return /\.lmcc$/i.test(String(filePath ?? '')) ? LMCC_LANGUAGE_ID : 'java';
}

// Register at import time: the language must exist before any model is
// created, including MonacoEditor's own mount-time model.
registerLmccLanguage();
