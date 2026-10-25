import React, { useState } from 'react';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { usePapers } from './usePapers';
import './PaperBar.css';

function refreshExplorer() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('lmcc:refresh-tree'));
  }
}

export default function PaperBar() {
  const { library, activate, openPaper, openPaperById, load } = usePapers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const active =
    library.papers.find((paper) => paper.id === library.activeId) || null;

  const handleChange = async (event) => {
    const id = event.target.value;
    if (!id || id === library.activeId) return;
    setBusy(true);
    setError(null);
    const result = await activate(id);
    setBusy(false);
    if (!result?.ok) {
      setError(result?.message || '无法切换试卷。');
      return;
    }
    if (result.active) openPaper(result.active);
    refreshExplorer();
  };

  const handleRefresh = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await load();
    setBusy(false);
    if (!result?.ok) {
      setError(result?.message || '重新扫描试卷失败。');
      return;
    }
    refreshExplorer();
  };

  const handleOpenOverview = () => {
    if (active) openPaperById(active.id);
  };

  return (
    <div className="paper-bar">
      <div className="paper-bar-row">
        <MenuBookRoundedIcon
          sx={{ fontSize: 15 }}
          className="paper-bar-icon"
        />
        <select
          className="paper-bar-select"
          value={library.activeId || ''}
          onChange={handleChange}
          disabled={busy || library.papers.length === 0}
          title={
            active
              ? `${active.root || active.path}`
              : library.root || '~/.lmcc-studio'
          }
          aria-label="切换试卷"
        >
          {library.papers.length === 0 ? (
            <option value="">未找到试卷</option>
          ) : null}
          {library.papers.map((paper) => (
            <option key={paper.id} value={paper.id}>
              {paper.name}
              {paper.recognized ? '' : ' · 无法识别'}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="paper-bar-button"
          onClick={handleOpenOverview}
          disabled={!active || busy}
          title="打开试卷概览"
        >
          <OpenInNewRoundedIcon sx={{ fontSize: 14 }} />
        </button>
        <button
          type="button"
          className="paper-bar-button"
          onClick={handleRefresh}
          disabled={busy}
          title="重新扫描 ~/.lmcc-studio"
        >
          <RefreshRoundedIcon
            sx={{ fontSize: 14 }}
            className={busy ? 'lmcc-spin' : ''}
          />
        </button>
      </div>
      {error ? (
        <button
          type="button"
          className="paper-bar-error"
          role="alert"
          title={`${error}（点击关闭）`}
          onClick={() => setError(null)}
        >
          {error}
        </button>
      ) : null}
    </div>
  );
}
