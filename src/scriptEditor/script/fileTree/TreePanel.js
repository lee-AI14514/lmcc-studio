import React, { useCallback, useEffect } from 'react';
import ItemNode from './ItemNode';
import { useRecoilState } from 'recoil';
import { selectedFile, directoryContentState } from '../../recoil/atom';
import system from '../../../system/system';
import { usePapers } from '../../../papers/usePapers';
import PaperBar from '../../../papers/PaperBar';

import Header from './Header';
import './TreePanel.css';

const TreePanel = () => {
  const [, setSelectedItem] = useRecoilState(selectedFile);
  const [directoryContent, setDirectoryContent] = useRecoilState(
    directoryContentState
  );
  const { library, load } = usePapers();

  const active =
    library.papers.find((paper) => paper.id === library.activeId) || null;
  const activeRoot = active?.root || active?.path || null;

  const init = useCallback(
    async (root, isCurrent = () => true) => {
      if (!root) {
        if (isCurrent()) setDirectoryContent([]);
        return;
      }
      try {
        const result = await system.getDirStructure(root);
        if (isCurrent()) setDirectoryContent(result);
      } catch (error) {
        console.error('Error:', error);
        if (isCurrent()) setDirectoryContent([]);
      }
    },
    [setDirectoryContent]
  );

  useEffect(() => {
    if (library.status === 'idle') load();
  }, [library.status, load]);

  useEffect(() => {
    if (!activeRoot) {
      setDirectoryContent([]);
      return undefined;
    }

    let alive = true;
    setSelectedItem(null);
    init(activeRoot, () => alive);

    const refresh = () => {
      if (alive) init(activeRoot, () => alive);
    };
    window.addEventListener('lmcc:refresh-tree', refresh);

    let offFileChange = null;
    if (window.electron?.onFileChange) {
      offFileChange = window.electron.onFileChange(refresh);
    }
    if (window.electron?.startWatcher) {
      window.electron.startWatcher(activeRoot);
    }

    return () => {
      alive = false;
      window.removeEventListener('lmcc:refresh-tree', refresh);
      if (typeof offFileChange === 'function') offFileChange();
    };
  }, [activeRoot, init, setDirectoryContent, setSelectedItem]);

  const handleSelect = (name) => {
    setSelectedItem(name);
  };

  return (
    <div className="tree-panel-container">
      <Header />
      <PaperBar />
      <div className="scrollable-content">
        {library.status === 'error' ? (
          <div className="tree-status is-error">
            {library.error || '无法读取试卷库。'}
          </div>
        ) : null}
        {library.status === 'loading' ? (
          <div className="tree-status">正在读取试卷…</div>
        ) : null}
        {library.status === 'ready' && !active ? (
          <div className="tree-status">
            未找到试卷。请在 {library.root || '~/.lmcc-studio'} 中新建文件夹。
          </div>
        ) : null}
        {directoryContent?.map((node, index) => (
          <ItemNode key={index} {...node} onSelect={handleSelect} />
        ))}
      </div>
    </div>
  );
};

export default TreePanel;
