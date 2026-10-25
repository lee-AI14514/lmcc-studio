import { useCallback, useEffect, useRef } from 'react';
import { useRecoilState } from 'recoil';
import { v4 as uuidv4 } from 'uuid';
import {
  currentTab,
  paperLibraryState,
  tabTable,
} from '../scriptEditor/recoil/atom';
import { buildPaper } from './paperModel';

export const PAPER_TAB_KIND = 'paper';

let pendingList = null;

function bridge() {
  return typeof window !== 'undefined' ? window.papers : null;
}

function uniqueTitle(tabs, baseTitle) {
  const titles = new Set(tabs.map((tab) => tab.title));
  if (!titles.has(baseTitle)) return baseTitle;
  let suffix = 2;
  while (titles.has(`${baseTitle} (${suffix})`)) {
    suffix += 1;
  }
  return `${baseTitle} (${suffix})`;
}

function normalize(result) {
  const papers = (result?.papers || []).map(buildPaper);
  const active =
    papers.find((paper) => paper.id === result?.activeId) || null;
  return { ...result, papers, active };
}

function fetchLibrary() {
  const api = bridge();
  if (!api?.list) {
    return Promise.reject(
      new Error(
        '当前环境不支持读取试卷库，请通过 Electron 启动 LMCC Studio。'
      )
    );
  }
  if (!pendingList) {
    pendingList = api.list().finally(() => {
      pendingList = null;
    });
  }
  return pendingList;
}

/**
 * The paper tab is read-only; it only stores the paper id so a library refresh
 * updates the overview in place.
 */
export function ensurePaperTab(tabs, paper) {
  const existing = tabs.find(
    (tab) => tab.kind === PAPER_TAB_KIND && tab.paperId === paper.id
  );
  if (existing) {
    return {
      tabs: tabs.map((tab) =>
        tab === existing
          ? {
              ...tab,
              paperPath: paper.path,
              paperRoot: paper.root,
              paperName: paper.name,
            }
          : tab
      ),
      title: existing.title,
    };
  }

  const id = uuidv4();
  const title = uniqueTitle(tabs, `试卷 · ${paper.name}`);
  return {
    tabs: [
      ...tabs,
      {
        id,
        title,
        kind: PAPER_TAB_KIND,
        paperId: paper.id,
        paperPath: paper.path,
        paperRoot: paper.root,
        paperName: paper.name,
        content: '',
        isSaved: true,
        modelUri: `inmemory://model/${id}`,
      },
    ],
    title,
  };
}

export function usePapers() {
  const [library, setLibrary] = useRecoilState(paperLibraryState);
  const [tabs, setTabs] = useRecoilState(tabTable);
  const [, setCurrentTab] = useRecoilState(currentTab);
  const tabsRef = useRef(tabs);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const load = useCallback(async () => {
    setLibrary((previous) => ({
      ...previous,
      status: previous.status === 'ready' ? 'refreshing' : 'loading',
      error: null,
    }));

    try {
      const result = normalize(await fetchLibrary());
      if (!result.ok) {
        setLibrary({
          status: 'error',
          root: result.root || null,
          activeId: null,
          papers: [],
          error: result.message || '无法读取试卷目录。',
          truncated: false,
        });
        return { ok: false, message: result.message };
      }

      setLibrary({
        status: 'ready',
        root: result.root,
        activeId: result.activeId,
        papers: result.papers,
        error: null,
        truncated: Boolean(result.truncated),
      });
      return { ...result, ok: true };
    } catch (error) {
      const message =
        error?.message || '无法读取试卷目录，请确认 ~/.lmcc-studio 存在。';
      setLibrary((previous) => ({
        ...previous,
        status: 'error',
        error: message,
      }));
      return { ok: false, message };
    }
  }, [setLibrary]);

  const activate = useCallback(
    async (id) => {
      const api = bridge();
      if (!api?.activate) {
        return { ok: false, message: '当前环境不支持切换试卷。' };
      }

      try {
        const raw = await api.activate(id);
        if (!raw?.ok) {
          return {
            ok: false,
            message: raw?.message || '无法打开这份试卷。',
          };
        }
        const result = normalize(raw);
        setLibrary({
          status: 'ready',
          root: result.root,
          activeId: result.activeId,
          papers: result.papers,
          error: null,
          truncated: Boolean(result.truncated),
        });
        return { ...result, ok: true };
      } catch (error) {
        return { ok: false, message: '切换试卷失败。' };
      }
    },
    [setLibrary]
  );

  const openPaper = useCallback(
    (paper) => {
      if (!paper) return null;
      const next = ensurePaperTab(tabsRef.current, paper);
      tabsRef.current = next.tabs;
      setTabs(next.tabs);
      setCurrentTab(next.title);
      return next.title;
    },
    [setTabs, setCurrentTab]
  );

  const openPaperById = useCallback(
    (id) => {
      const paper = library.papers.find((item) => item.id === id);
      if (!paper) return null;
      return openPaper(paper);
    },
    [library.papers, openPaper]
  );

  return {
    library,
    load,
    activate,
    openPaper,
    openPaperById,
  };
}

let startupPromise = null;

/**
 * Open the first available paper overview once per app session. The module
 * level promise survives React StrictMode's double effect invocation, so the
 * paper tab is opened exactly once.
 */
export function useStartupPaper() {
  const { load, openPaper } = usePapers();

  useEffect(() => {
    if (!startupPromise) {
      startupPromise = load()
        .then((result) => {
          if (result?.active) openPaper(result.active);
          return result;
        })
        .catch(() => null);
    }
  }, [load, openPaper]);
}
