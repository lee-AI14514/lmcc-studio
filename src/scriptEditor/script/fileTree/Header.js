import React, { useState } from 'react';
import NoteAddRoundedIcon from '@mui/icons-material/NoteAddRounded';
import { useLmccActions } from '../../../lmcc/useLmccActions';
import { usePapers } from '../../../papers/usePapers';
import './TreePanel.css';


const Header = () => {
  const { openFromDialog, busy } = useLmccActions();
  const { library } = usePapers();
  const [error, setError] = useState(null);
  const active =
    library.papers.find((paper) => paper.id === library.activeId) || null;

  const handleOpenQuestion = async () => {
    setError(null);
    const result = await openFromDialog();
    if (!result?.ok && !result?.canceled) {
      setError(result?.message || '打开题目失败。');
    }
  };

  return (
    <header className="editor-header">
      <div className="header-titles">
        <div className="header-title explorer-title">Explorer</div>
        <div
          className="header-title editor-title"
          title={active?.root || active?.path || '~/.lmcc-studio'}
        >
          {active?.name || '未选择试卷'}
        </div>
      </div>
      <button
        type="button"
        className="open-question-button"
        onClick={handleOpenQuestion}
        disabled={busy}
        title="打开 .lmcc 题目文件（Ctrl/Cmd+O）"
      >
        <NoteAddRoundedIcon sx={{ fontSize: 15 }} />
        <span>{busy ? '打开中…' : '打开题目'}</span>
      </button>
      {error ? (
        <button
          type="button"
          className="explorer-error"
          role="alert"
          title={`${error}（点击关闭）`}
          onClick={() => setError(null)}
        >
          {error}
        </button>
      ) : null}
    </header>
  );
};

export default Header;
