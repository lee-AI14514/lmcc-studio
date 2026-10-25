import React, { useEffect } from 'react';

import TreePanel from './script/fileTree/TreePanel';
import './ScriptEditor.Main.css';
import TabsEditor from './TabsEditor';
import Split from 'react-split';
import './Scrolbar.css';
import Footer from './Footer';
import { useLmccActions } from '../lmcc/useLmccActions';
import { useStartupPaper } from '../papers/usePapers';

const ScriptEditorMain = () => {
  const { openFromDialog } = useLmccActions();
  useStartupPaper();

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'o'
      ) {
        event.preventDefault();
        openFromDialog();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openFromDialog]);

  return (
    <div className="app-shell">
      <Split
        sizes={[16, 84]}
        minSize={100}
        expandToMin={false}
        gutterSize={3}
        className="split-flex"
        direction="horizontal"
      >
        <div className="panel">
          <TreePanel />
        </div>
        <div className="panel" style={{ overflowY: 'hidden' }}>
          <TabsEditor />
        </div>
      </Split>
      <Footer />
    </div>
  );
};

export default ScriptEditorMain;
