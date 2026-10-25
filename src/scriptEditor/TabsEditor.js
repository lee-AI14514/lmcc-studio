import React, { useRef, useState } from 'react';
import { useRecoilState } from 'recoil';
import * as monaco from 'monaco-editor';
import {
  tabTable,
  currentTab,
  directoryContentState,
} from './recoil/atom';
import { Nav, NavItem, CloseButton, UnsavedDot } from './Nav';
import ScriptWorkSpace from './script/ScriptWorkSpace';
import './Editor.css';
import DefWorkSpace from './DefWorkSpace';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { findPathByName } from './global/editorGlobal';
import LmccReader from '../lmcc/LmccReader';
import { LMCC_TAB_KIND } from '../lmcc/useLmccActions';
import PaperView from '../papers/PaperView';
import { PAPER_TAB_KIND } from '../papers/usePapers';
import system from '../system/system';
import DeleteConfirmationModal from './script/alert/DeleteConfirmationModal';


const TabsEditor = (props) => {
  const [r_tabTable, set_r_tabTable] = useRecoilState(tabTable);
  const [r_currentTab, set_r_currentTab] = useRecoilState(currentTab);
  const [hoverTab, setHoverTab] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const tabRefs = useRef({});
  const [directoryContent] = useRecoilState(
    directoryContentState,
  );
  const activeTab = r_tabTable.find((tab) => tab.title === r_currentTab);

  const changeTab = (tabId) => {
    set_r_currentTab(tabId);
  };

  const closeTab = (tabTitle) => {
    const tab = r_tabTable.find((item) => item.title === tabTitle);
    if (tab?.modelUri) {
      try {
        const model = monaco.editor.getModel(monaco.Uri.parse(tab.modelUri));
        if (model) model.dispose();
      } catch (error) {
        // the model may already be gone; closing the tab is still safe
      }
    }

    const nextTabs = r_tabTable.filter((item) => item.title !== tabTitle);
    set_r_tabTable(nextTabs);
    if (r_currentTab === tabTitle) {
      set_r_currentTab(nextTabs.length ? nextTabs[0].title : null);
    }
    setPendingDelete(null);
    setSaveError(null);
  };

  const removeTab = (tabTitle, event) => {
    event.stopPropagation();
    const tab = r_tabTable.find((item) => item.title === tabTitle);
    if (!tab) return;

    if (tab.isSaved) {
      closeTab(tabTitle);
      return;
    }
    set_r_currentTab(tabTitle);
    setPendingDelete(tab);
    setSaveError(null);
  };

  const savePendingTab = async () => {
    if (!pendingDelete) return;
    let content = pendingDelete.content ?? '';
    if (pendingDelete.modelUri) {
      const model = monaco.editor.getModel(
        monaco.Uri.parse(pendingDelete.modelUri)
      );
      if (model) content = model.getValue();
    }

    try {
      if (pendingDelete.filePath) {
        await system.writeFile(pendingDelete.filePath, content);
      }
      closeTab(pendingDelete.title);
    } catch (error) {
      console.error('Error save File:', error);
      setSaveError('保存文件失败，请重试。');
    }
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {r_tabTable.length > 0 ? (
        <>
          <Nav>
            {r_tabTable.map((tab) => {
               const isPresentInDirectory =
                tab.kind === PAPER_TAB_KIND ||
                Boolean(tab.filePath) ||
                findPathByName(directoryContent, tab.title);
              const isActive = r_currentTab === tab.title;
              const isLmccTab = tab.kind === LMCC_TAB_KIND;
              const isPaperTab = tab.kind === PAPER_TAB_KIND;
              const TabIcon = isLmccTab || isPaperTab
                ? MenuBookRoundedIcon
                : InsertDriveFileRoundedIcon;
              return (
              <NavItem
                key={tab.title}
                $active={isActive}
                onClick={() => changeTab(tab.title)}
                ref={(el) => (tabRefs.current[tab.title] = el)}
                onMouseEnter={() => setHoverTab(tab.title)} 
                onMouseLeave={() => setHoverTab(null)} 
              >
                <TabIcon
                  sx={{
                    fontSize: 15,
                    flex: '0 0 auto',
                    color: isActive
                      ? 'var(--accent-bright)'
                      : 'var(--text-muted)',
                  }}
                />
                <span
                    style={
                      isPresentInDirectory
                        ? {}
                        : { color: 'var(--danger)', textDecoration: 'line-through' }
                    }
                  >
                    {tab.title}
                  </span>
                <CloseButton onClick={(event) => removeTab(tab.title, event)}>
                  {hoverTab === tab.title ? (
                    <CloseRoundedIcon sx={{ fontSize: 14 }} />
                  ) : !tab.isSaved ? (
                    <UnsavedDot />
                  ) : isActive ? (
                    <CloseRoundedIcon sx={{ fontSize: 14 }} />
                  ) : null}
                </CloseButton>
              </NavItem>
              );
})}
          </Nav>
          <div className="ScriptEditor">
            {activeTab?.kind === PAPER_TAB_KIND ? (
              <PaperView key={activeTab.title} tab={activeTab} />
            ) : activeTab?.kind === LMCC_TAB_KIND ? (
              <LmccReader key={activeTab.title} tab={activeTab} />
            ) : (
              <ScriptWorkSpace treePanelWidth={props.treePanelWidth} />
            )}
          </div>
        </>
      ) : (
        <DefWorkSpace />
      )}

      <DeleteConfirmationModal
        targetTiTle={pendingDelete?.title || ''}
        isOpen={Boolean(pendingDelete)}
        error={saveError}
        onSave={savePendingTab}
        onDontSave={() => pendingDelete && closeTab(pendingDelete.title)}
        onClose={() => {
          setPendingDelete(null);
          setSaveError(null);
        }}
      />
    </div>
  );
};

export default TabsEditor;
