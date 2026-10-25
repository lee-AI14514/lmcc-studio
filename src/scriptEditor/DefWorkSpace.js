import React, { useEffect, useState } from 'react';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { usePapers } from '../papers/usePapers';
import { paperStatusLabel, paperStatusTone } from '../papers/paperModel';
import './DefWorkSpace.css';

const DefWorkSpace = () => {
  const { library, load, activate, openPaper } = usePapers();
  const [error, setError] = useState(null);

  useEffect(() => {
    if (library.status === 'idle') load();
  }, [library.status, load]);

  const handleOpen = async (paper) => {
    setError(null);
    const result = await activate(paper.id);
    if (!result?.ok) {
      setError(result?.message || '无法打开试卷。');
      return;
    }
    if (result.active) openPaper(result.active);
  };

  return (
    <div className="welcome">
      <div className="welcome-orb welcome-orb-a" />
      <div className="welcome-orb welcome-orb-b" />

      <div className="welcome-content">
        <div className="welcome-mark">L</div>
        <h1 className="welcome-title">LMCC Studio</h1>
        <p className="welcome-sub">
          试卷保存在 <code className="welcome-path">~/.lmcc-studio</code>
          ，每个文件夹就是一份试卷。打开一份试卷即可开始阅读其中的
          <code>.lmcc</code> 题目。
        </p>

        {library.status === 'loading' ? (
          <div className="welcome-tip">正在读取试卷库…</div>
        ) : null}

        {library.error ? (
          <div className="welcome-error" role="alert">
            <ErrorOutlineRoundedIcon sx={{ fontSize: 16 }} />
            {library.error}
          </div>
        ) : null}

        {error ? (
          <div className="welcome-error" role="alert">
            <ErrorOutlineRoundedIcon sx={{ fontSize: 16 }} />
            {error}
          </div>
        ) : null}

        {library.status === 'ready' && library.papers.length === 0 ? (
          <div className="welcome-tip">
            还没有试卷：在 {library.root || '~/.lmcc-studio'} 中新建一个文件夹，
            放入至少一个 .lmcc 题目文件。
          </div>
        ) : null}

        {library.papers.length > 0 ? (
          <div className="welcome-papers">
            {library.papers.map((paper) => (
              <button
                key={paper.id}
                type="button"
                className="welcome-paper"
                onClick={() => handleOpen(paper)}
              >
                <span className="welcome-paper-icon">
                  <FolderRoundedIcon sx={{ fontSize: 18 }} />
                </span>
                <span className="welcome-paper-copy">
                  <span className="welcome-paper-name">{paper.name}</span>
                  <span className="welcome-paper-meta">
                    {paper.recognized
                      ? `${paper.summary.total} 道题`
                      : '无法识别'}
                    <span className={`welcome-paper-state is-${paperStatusTone(paper)}`}>
                      {paperStatusLabel(paper)}
                    </span>
                  </span>
                </span>
                <ChevronRightRoundedIcon
                  sx={{ fontSize: 17 }}
                  className="welcome-paper-chevron"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default DefWorkSpace;
