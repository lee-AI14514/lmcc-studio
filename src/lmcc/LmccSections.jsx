import React from 'react';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DataObjectRoundedIcon from '@mui/icons-material/DataObjectRounded';
import { typeLabel } from './lmccParser';
import { basenameOf, formatBytes } from './pathUtils';
import { describeStatus } from './questionAssets';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

const SEVERITY_ICON = {
  error: ErrorOutlineRoundedIcon,
  warning: WarningAmberRoundedIcon,
  info: InfoOutlinedIcon,
};

export function TypePill({ type, declaredType }) {
  const resolved = type || 'unknown';
  return (
    <span className={`lmcc-type-pill lmcc-type-${resolved}`}>
      <DataObjectRoundedIcon sx={{ fontSize: 13 }} />
      {type ? typeLabel(type) : '无法解析'}
      {declaredType && declaredType !== type ? (
        <span className="lmcc-type-declared">声明：{declaredType}</span>
      ) : null}
    </span>
  );
}

const TOKEN_PATTERN =
  /("(?:[^"\\]|\\.)*"|LMCC\/\d+|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b)/g;

function tokenizeLine(line) {
  return line.split(TOKEN_PATTERN).map((part, index) => {
    if (!part) return null;
    if (part.startsWith('"')) {
      return (
        <span className="lmcc-token-string" key={index}>
          {part}
        </span>
      );
    }
    if (part.startsWith('LMCC/')) {
      return (
        <span className="lmcc-token-magic" key={index}>
          {part}
        </span>
      );
    }
    if (/^-?\d/.test(part)) {
      return (
        <span className="lmcc-token-number" key={index}>
          {part}
        </span>
      );
    }
    if (/^(?:true|false|null)$/.test(part)) {
      return (
        <span className="lmcc-token-literal" key={index}>
          {part}
        </span>
      );
    }
    return part;
  });
}

export function SourceView({ source, maxLines = 12000 }) {
  const text = String(source ?? '');
  const lines = React.useMemo(() => text.split('\n'), [text]);
  const visible = lines.slice(0, maxLines);

  if (!text) {
    return <div className="lmcc-empty">文件内容为空。</div>;
  }

  return (
    <div className="lmcc-source">
      <div className="lmcc-source-body">
        {visible.map((line, index) => (
          <div className="lmcc-source-row" key={index}>
            <span className="lmcc-source-line-number">{index + 1}</span>
            <code className="lmcc-source-line">{tokenizeLine(line)}</code>
          </div>
        ))}
      </div>
      {lines.length > maxLines ? (
        <div className="lmcc-source-truncated">
          仅显示前 {maxLines.toLocaleString()} 行（共{' '}
          {lines.length.toLocaleString()} 行）。
        </div>
      ) : null}
    </div>
  );
}

export function ChecksCard({ checks, loading }) {
  const unique = React.useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const item of checks || []) {
      const key = `${item.severity}\u0000${item.message}\u0000${item.field || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(item);
    }
    return list.sort(
      (left, right) =>
        (SEVERITY_ORDER[left.severity] ?? 9) -
        (SEVERITY_ORDER[right.severity] ?? 9)
    );
  }, [checks]);

  const counts = unique.reduce(
    (result, item) => {
      result[item.severity] = (result[item.severity] || 0) + 1;
      return result;
    },
    { error: 0, warning: 0, info: 0 }
  );

  return (
    <section className="lmcc-card lmcc-checks-card">
      <div className="lmcc-card-head">
        <h2>校验</h2>
        <div className="lmcc-check-counts">
          {counts.error > 0 ? (
            <span className="lmcc-count lmcc-count-error">{counts.error}</span>
          ) : null}
          {counts.warning > 0 ? (
            <span className="lmcc-count lmcc-count-warning">
              {counts.warning}
            </span>
          ) : null}
          {counts.info > 0 ? (
            <span className="lmcc-count lmcc-count-info">{counts.info}</span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="lmcc-check-skeleton">
          <span />
          <span />
          <span />
        </div>
      ) : unique.length === 0 ? (
        <div className="lmcc-empty lmcc-empty-ok">
          <CheckCircleRoundedIcon sx={{ fontSize: 17 }} />
          未发现配置问题
        </div>
      ) : (
        <ul className="lmcc-check-list">
          {unique.map((item, index) => {
            const Icon = SEVERITY_ICON[item.severity] || InfoOutlinedIcon;
            return (
              <li
                key={`${item.code}-${index}`}
                className={`lmcc-check lmcc-check-${item.severity}`}
              >
                <span className="lmcc-check-icon">
                  <Icon sx={{ fontSize: 16 }} />
                </span>
                <span className="lmcc-check-content">
                  <span className="lmcc-check-message">{item.message}</span>
                  {item.field ? (
                    <code className="lmcc-check-field">{item.field}</code>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MetaRow({ label, children, mono = false }) {
  return (
    <div className="lmcc-meta-row">
      <span className="lmcc-meta-label">{label}</span>
      <span className={`lmcc-meta-value${mono ? ' is-mono' : ''}`}>
        {children}
      </span>
    </div>
  );
}

export function MetaCard({ result, tab, root, assets }) {
  const question = result.question;
  const remoteDebug =
    question.remoteDebug === undefined
      ? '未声明（默认允许）'
      : question.remoteDebug
      ? '允许'
      : '禁用';

  return (
    <section className="lmcc-card">
      <div className="lmcc-card-head">
        <h2>题目信息</h2>
        <span className="lmcc-card-hint">{basenameOf(tab.filePath)}</span>
      </div>
      <div className="lmcc-meta">
        <MetaRow label="题型">
          {typeLabel(result.type)}
          {result.declaredType !== result.type
            ? `（声明为 ${result.declaredType}）`
            : ''}
        </MetaRow>
        <MetaRow label="题目 ID">{question.id}</MetaRow>
        <MetaRow label="根目录" mono>
          {root || '未知'}
        </MetaRow>
        <MetaRow label="题目 home" mono>
          {result.paths.home ? `${root}/${result.paths.home}` : '题目根目录'}
        </MetaRow>
        <MetaRow label="题面" mono>
          {question.statement}
        </MetaRow>
        <MetaRow label="文件">
          {question.files.length} 个声明
          {tab.size ? ` · ${formatBytes(tab.size)}` : ''}
        </MetaRow>
        <MetaRow label="作答项">
          {question.inputs ? `${question.inputs.length} 项` : '未声明'}
        </MetaRow>
        <MetaRow label="远端调试">{remoteDebug}</MetaRow>
        <MetaRow label="提交接口">
          {question.submission
            ? '已配置（AES-256-GCM 信封）'
            : '未配置'}
        </MetaRow>
        <MetaRow label="评测代码" mono>
          {question.evaluationCode || '—'}
        </MetaRow>
        <MetaRow label="本地评测" mono>
          {question.localTest?.script || '—'}
        </MetaRow>
        <MetaRow label="Prompt Token">
          {question.promptLimit
            ? `≤ ${question.promptLimit.maxTokens} · ${question.promptLimit.tokenizer}`
            : '—'}
        </MetaRow>
      </div>
      {assets?.status === 'ready' ? null : (
        <div className="lmcc-card-foot">正在检查答案文件…</div>
      )}
    </section>
  );
}

function statusClass(entry, loading, required = true) {
  if (loading) return 'is-checking';
  if (!entry) return 'is-unknown';
  if (entry.state === 'file' || entry.state === 'directory') return 'is-ok';
  if (entry.state === 'missing') {
    return required ? 'is-missing' : 'is-optional-missing';
  }
  return 'is-error';
}

function statusText(entry, loading) {
  if (loading) return '检查中…';
  if (!entry) return '未检查';
  if (entry.state === 'file' || entry.state === 'directory') {
    return `${describeStatus(entry)}${
      entry.state === 'file' && Number.isFinite(entry.size)
        ? ` · ${formatBytes(entry.size)}`
        : ''
    }`;
  }
  return describeStatus(entry);
}

export function AnswerFilesCard({ question, assets }) {
  const loading = assets.status === 'loading';
  const entries = assets.status === 'ready' ? assets.entries : [];
  const byPath = new Map(entries.map((entry) => [entry.rel, entry]));

  return (
    <section className="lmcc-card">
      <div className="lmcc-card-head">
        <h2>答案文件</h2>
        <span className="lmcc-card-hint">
          最多 1000 个 · 总大小 ≤ 10 MB
        </span>
      </div>

      {question.files.length === 0 ? (
        <div className="lmcc-empty">
          智能体题不声明本地答案文件，代码由聊天生成并同步。
        </div>
      ) : (
        <div className="lmcc-table-wrap">
          <table className="lmcc-file-table">
            <thead>
              <tr>
                <th>答案路径</th>
                <th>归档路径</th>
                <th>类型</th>
                <th>必需</th>
                <th>长度限制</th>
                <th>磁盘状态</th>
              </tr>
            </thead>
            <tbody>
              {question.files.map((file, index) => {
                const entry = byPath.get(file.path);
                return (
                  <tr key={`${file.path}-${index}`}>
                    <td>
                      <code className="lmcc-path">{file.path}</code>
                    </td>
                    <td>
                      <code className="lmcc-path">{file.archivePath}</code>
                    </td>
                    <td>{file.directory ? '目录' : '普通文件'}</td>
                    <td>
                      <span
                        className={`lmcc-badge ${
                          file.required ? 'is-required' : 'is-optional'
                        }`}
                      >
                        {file.required ? '必需' : '可选'}
                      </span>
                    </td>
                    <td>
                      {file.maxLength !== undefined
                        ? `${file.minLength}–${file.maxLength} 字符`
                        : '—'}
                    </td>
                    <td>
                      <span
                        className={`lmcc-status ${statusClass(
                          entry,
                          loading,
                          file.required
                        )}`}
                      >
                        {statusText(entry, loading)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function describeRange(field) {
  if (field.type === 'boolean') return '开关';
  const parts = [];
  if (field.min !== undefined) parts.push(`≥ ${field.min}`);
  if (field.max !== undefined) parts.push(`≤ ${field.max}`);
  if (field.options) parts.push(`选项 ${field.options.join(', ')}`);
  return parts.length ? parts.join(' · ') : '—';
}

const INPUT_KIND_LABEL = {
  file: '文件',
  upload: '上传',
  parameters: '参数',
};

export function InputsCard({ question }) {
  const inputs = question.inputs || [];

  return (
    <section className="lmcc-card">
      <div className="lmcc-card-head">
        <h2>可配置作答项</h2>
        <span className="lmcc-card-hint">{inputs.length} 项</span>
      </div>

      <div className="lmcc-inputs">
        {inputs.map((input, index) => (
          <div className="lmcc-input" key={`${input.file}-${index}`}>
            <div className="lmcc-input-head">
              <span className="lmcc-input-kind">
                {INPUT_KIND_LABEL[input.kind] || input.kind}
              </span>
              <span className="lmcc-input-label">{input.label}</span>
              <code className="lmcc-input-file">{input.file}</code>
            </div>

            {input.kind === 'file' && input.preview ? (
              <div className="lmcc-input-note">允许预览答案内容</div>
            ) : null}

            {input.kind === 'upload' ? (
              <div className="lmcc-input-note">
                扩展名：
                {input.extensions.map((extension) => (
                  <span className="lmcc-chip" key={extension}>
                    .{extension}
                  </span>
                ))}
                {input.format ? (
                  <span className="lmcc-chip is-accent">
                    格式 {input.format}
                  </span>
                ) : null}
              </div>
            ) : null}

            {input.kind === 'parameters' ? (
              <div className="lmcc-table-wrap">
                <table className="lmcc-params-table">
                  <thead>
                    <tr>
                      <th>key</th>
                      <th>标签</th>
                      <th>类型</th>
                      <th>范围 / 选项</th>
                      <th>默认值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {input.fields.map((field) => (
                      <tr key={field.key}>
                        <td>
                          <code className="lmcc-path">{field.key}</code>
                        </td>
                        <td>{field.label}</td>
                        <td>{field.type}</td>
                        <td>{describeRange(field)}</td>
                        <td>
                          {field.default === undefined
                            ? '—'
                            : String(field.default)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PromptCard({ question, assets }) {
  const file = question.files[0];
  const info = assets.status === 'ready' ? assets.promptInfo : null;
  const length = info?.length;
  const maxLength = file?.maxLength;
  const ratio =
    Number.isFinite(length) && maxLength > 0
      ? Math.min(100, Math.round((length / maxLength) * 100))
      : 0;
  const overLimit = Number.isFinite(length) && length > maxLength;
  const underMinimum =
    Number.isFinite(length) && length < (file?.minLength || 0);

  return (
    <section className="lmcc-card">
      <div className="lmcc-card-head">
        <h2>Prompt 检查</h2>
        <span className="lmcc-card-hint">UTF-16 字符</span>
      </div>

      <div className="lmcc-prompt-stats">
        <div className="lmcc-prompt-stat">
          <span className="lmcc-prompt-stat-label">当前</span>
          <span className="lmcc-prompt-stat-value">
            {Number.isFinite(length)
              ? length.toLocaleString()
              : assets.status === 'loading'
              ? '…'
              : '—'}
          </span>
        </div>
        <div className="lmcc-prompt-stat">
          <span className="lmcc-prompt-stat-label">下限</span>
          <span className="lmcc-prompt-stat-value">
            {(file?.minLength || 0).toLocaleString()}
          </span>
        </div>
        <div className="lmcc-prompt-stat">
          <span className="lmcc-prompt-stat-label">上限</span>
          <span className="lmcc-prompt-stat-value">
            {Number.isFinite(maxLength)
              ? maxLength.toLocaleString()
              : '—'}
          </span>
        </div>
      </div>

      <div className="lmcc-progress" aria-hidden="true">
        <span
          className={`lmcc-progress-fill ${
            overLimit || underMinimum ? 'is-bad' : 'is-good'
          }`}
          style={{ width: `${ratio}%` }}
        />
      </div>

      <div className="lmcc-prompt-meta">
        <span>
          归档名 <code className="lmcc-path">{file?.archivePath}</code>
        </span>
        {question.promptLimit ? (
          <span>
            Token 上限{' '}
            <strong>{question.promptLimit.maxTokens}</strong>（GLM-4）
          </span>
        ) : null}
      </div>

      {info?.preview ? (
        <div className="lmcc-prompt-preview">
          <div className="lmcc-prompt-preview-head">内容预览</div>
          <pre>{info.preview}</pre>
        </div>
      ) : null}
    </section>
  );
}

export function TrainingCard({ question, assets }) {
  const entries = assets.status === 'ready' ? assets.entries : [];
  const byPath = new Map(entries.map((entry) => [entry.rel, entry]));

  return (
    <section className="lmcc-card">
      <div className="lmcc-card-head">
        <h2>训练文件</h2>
        <span className="lmcc-card-hint">固定归档名</span>
      </div>
      <div className="lmcc-training-list">
        {question.files.map((file) => {
          const entry = byPath.get(file.path);
          return (
            <div className="lmcc-training-row" key={file.archivePath}>
              <code className="lmcc-path">{file.archivePath}</code>
              <span className={`lmcc-status ${statusClass(entry, assets.status === 'loading')}`}>
                {statusText(entry, assets.status === 'loading')}
              </span>
            </div>
          );
        })}
      </div>
      <div className="lmcc-card-foot">
        提交前还会校验数据文件为 UTF-8 JSONL、参数文件为合法 JSON，并核对训练产物的文件哈希。
      </div>
    </section>
  );
}
