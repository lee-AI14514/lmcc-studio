import { useCallback, useState } from 'react';
import { useRecoilState } from 'recoil';
import { v4 as uuidv4 } from 'uuid';
import { tabTable, currentTab } from '../scriptEditor/recoil/atom';
import { basenameOf } from './pathUtils';
import { readQuestionSource } from './questionAssets';

export const LMCC_TAB_KIND = 'lmcc';
export const TEXT_TAB_KIND = 'file';

function uniqueTitle(tabs, baseTitle) {
  const titles = new Set(tabs.map((tab) => tab.title));
  if (!titles.has(baseTitle)) return baseTitle;
  let suffix = 2;
  while (titles.has(`${baseTitle} (${suffix})`)) {
    suffix += 1;
  }
  return `${baseTitle} (${suffix})`;
}

/**
 * Update the reader tab for a question, or create one. The tab title doubles as
 * the editor key throughout the app, so it is kept unique.
 */
export function ensureLmccTab(tabs, source) {
  const filePath = source.filePath;
  const existing = tabs.find(
    (tab) => tab.kind === LMCC_TAB_KIND && tab.filePath === filePath
  );

  if (existing) {
    return {
      tabs: tabs.map((tab) =>
        tab === existing
          ? {
              ...tab,
              content: tab.isSaved === false ? tab.content : source.content,
              root: source.root ?? tab.root,
              size: source.size ?? tab.size,
              loadError: source.loadError ?? null,
              isSaved: tab.isSaved === false ? false : true,
            }
          : tab
      ),
      title: existing.title,
    };
  }

  const id = uuidv4();
  const title = uniqueTitle(tabs, basenameOf(filePath));
  return {
    tabs: [
      ...tabs,
      {
        id,
        title,
        filePath,
        root: source.root ?? null,
        size: source.size ?? null,
        content: source.content ?? '',
        loadError: source.loadError ?? null,
        kind: LMCC_TAB_KIND,
        isSaved: true,
        modelUri: `inmemory://model/${id}`,
      },
    ],
    title,
  };
}

export function ensureTextTab(tabs, sourceTab) {
  const existing = tabs.find(
    (tab) => tab.kind !== LMCC_TAB_KIND && tab.filePath === sourceTab.filePath
  );
  if (existing) {
    return { tabs, title: existing.title };
  }

  const id = uuidv4();
  const base = `${basenameOf(sourceTab.filePath)} · 文本`;
  const title = uniqueTitle(tabs, base);
  return {
    tabs: [
      ...tabs,
      {
        id,
        title,
        filePath: sourceTab.filePath,
        content: sourceTab.content ?? '',
        kind: TEXT_TAB_KIND,
        isSaved: true,
        modelUri: `inmemory://model/${id}`,
      },
    ],
    title,
  };
}

/**
 * Shared open/reload actions for `.lmcc` questions.
 */
export function useLmccActions() {
  const [tabs, setTabs] = useRecoilState(tabTable);
  const [, setCurrentTab] = useRecoilState(currentTab);
  const [busy, setBusy] = useState(false);

  const openQuestionFile = useCallback(
    async (filePath) => {
      setBusy(true);
      try {
        const source = await readQuestionSource(filePath);
        if (!source?.ok) {
          const failed = ensureLmccTab(tabs, {
            filePath,
            content: '',
            root: null,
            loadError: source?.message || '题目文件读取失败。',
          });
          setTabs(failed.tabs);
          setCurrentTab(failed.title);
          return source || { ok: false, message: '题目文件读取失败。' };
        }
        const next = ensureLmccTab(tabs, source);
        setTabs(next.tabs);
        setCurrentTab(next.title);
        return { ok: true, title: next.title, source };
      } finally {
        setBusy(false);
      }
    },
    [tabs, setTabs, setCurrentTab]
  );

  const openFromDialog = useCallback(async () => {
    if (!window.lmcc?.pickQuestionFile) {
      return {
        ok: false,
        message: '当前环境不支持读取本地文件，请通过 Electron 启动 LMCC Studio。',
      };
    }
    setBusy(true);
    try {
      const result = await window.lmcc.pickQuestionFile();
      if (!result) return { ok: false, message: '题目文件读取失败。' };
      if (result.canceled) return { ok: true, canceled: true };
      if (!result.ok) return result;
      const next = ensureLmccTab(tabs, result);
      setTabs(next.tabs);
      setCurrentTab(next.title);
      return { ok: true, title: next.title, source: result };
    } catch (error) {
      return { ok: false, message: '打开题目失败。' };
    } finally {
      setBusy(false);
    }
  }, [tabs, setTabs, setCurrentTab]);

  const openInEditor = useCallback(
    async (sourceTab) => {
      if (!sourceTab?.filePath) return;
      let content = sourceTab.content ?? '';
      if (!content) {
        // A reader tab that failed to load has no content yet; make sure the
        // text tab is not created empty (an accidental save would truncate
        // the question file).
        const source = await readQuestionSource(sourceTab.filePath);
        if (source?.ok) content = source.content;
      }
      const next = ensureTextTab(tabs, { ...sourceTab, content });
      setTabs(next.tabs);
      setCurrentTab(next.title);
    },
    [tabs, setTabs, setCurrentTab]
  );

  const reloadQuestion = useCallback(
    async (sourceTab) => {
      if (!sourceTab?.filePath) {
        return { ok: false, message: '题目文件路径未知。' };
      }
      const result = await readQuestionSource(sourceTab.filePath);
      setTabs((previous) =>
        previous.map((tab) =>
          tab.kind === LMCC_TAB_KIND && tab.filePath === sourceTab.filePath
            ? {
                ...tab,
                content: result?.ok ? result.content : tab.content,
                root: result?.root ?? tab.root,
                size: result?.size ?? tab.size,
                loadError: result?.ok
                  ? null
                  : tab.content
                  ? null
                  : result?.message || '题目文件读取失败。',
                isSaved: true,
              }
            : tab
        )
      );
      return result;
    },
    [setTabs]
  );

  return {
    busy,
    openQuestionFile,
    openFromDialog,
    openInEditor,
    reloadQuestion,
  };
}
