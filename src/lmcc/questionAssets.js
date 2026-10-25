/**
 * Loads the filesystem side of a parsed question: statement Markdown, answer
 * file status and the extra content checks for prompt/training questions.
 *
 * Everything is defensive: a missing bridge, a missing file or an unreadable
 * statement turns into a check, never into an exception.
 */
import system from '../system/system';
import { dirnameOf, joinAbsolute } from './pathUtils';
import { PROMPT_EXAM_INFO_CLS_ID } from './lmccParser';

export const MAX_STATEMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ANSWER_READ_BYTES = 10 * 1024 * 1024;

function bridge() {
  return typeof window !== 'undefined' ? window.lmcc : null;
}

function decodeUtf8(buffer) {
  const bytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function failure(message, code = 'io') {
  return { ok: false, code, message };
}

export async function readQuestionSource(filePath) {
  const api = bridge();
  if (api?.readSource) {
    const result = await api.readSource(filePath);
    if (!result) return failure('题目文件读取失败。');
    if (result.canceled) return { ok: true, canceled: true };
    return result;
  }

  try {
    const buffer = await system.readFileSync(filePath);
    const content = decodeUtf8(buffer);
    return {
      ok: true,
      filePath,
      root: dirnameOf(filePath),
      content,
      size: buffer?.byteLength ?? content.length,
    };
  } catch (error) {
    return failure('无法读取题目文件。');
  }
}

export async function readQuestionText(root, rel, maxBytes) {
  const api = bridge();
  if (api?.readQuestionText) {
    const result = await api.readQuestionText(root, rel, maxBytes);
    return result || failure('文件读取失败。');
  }

  if (!root) return failure('题目根目录未知。');
  try {
    const buffer = await system.readFileSync(joinAbsolute(root, rel));
    if (buffer?.byteLength > (maxBytes || MAX_ANSWER_READ_BYTES)) {
      return failure('文件超过读取上限。', 'too-large');
    }
    return {
      ok: true,
      content: decodeUtf8(buffer),
      size: buffer?.byteLength ?? 0,
    };
  } catch (error) {
    if (/utf-8|encoded/i.test(String(error?.message))) {
      return failure('文件不是有效的 UTF-8 文本。', 'encoding');
    }
    return failure('无法读取文件。');
  }
}

export async function statQuestionPaths(root, rels) {
  const api = bridge();
  if (api?.statQuestionPaths) {
    return (
      (await api.statQuestionPaths(root, rels)) || {
        ok: false,
        message: '文件状态读取失败。',
      }
    );
  }
  return {
    ok: false,
    unsupported: true,
    message: '当前环境不支持检查答案文件状态。',
  };
}

function check(severity, code, message, field) {
  return { severity, code, message, field };
}

function collectFileStatusChecks(question, entries) {
  const checks = [];
  const byPath = new Map(entries.map((entry) => [entry.rel, entry]));

  for (const file of question.files) {
    const entry = byPath.get(file.path);
    if (!entry) continue;

    if (entry.state === 'missing') {
      checks.push(
        file.required
          ? check(
              'error',
              'LMCC_FILE_MISSING',
              `必需答案文件不存在：${file.path}`,
              file.path
            )
          : check(
              'info',
              'LMCC_FILE_MISSING_OPTIONAL',
              `可选答案文件不存在：${file.path}`,
              file.path
            )
      );
      continue;
    }

    if (entry.state === 'symlink') {
      checks.push(
        check(
          'error',
          'LMCC_FILE_SYMLINK',
          entry.message || `不支持链接路径：${file.path}`,
          file.path
        )
      );
      continue;
    }

    if (entry.state === 'unsafe' || entry.state === 'io') {
      checks.push(
        check('error', 'LMCC_FILE_INACCESSIBLE', entry.message, file.path)
      );
      continue;
    }

    if (file.directory && entry.state !== 'directory') {
      checks.push(
        check(
          'warning',
          'LMCC_FILE_KIND',
          `声明为目录，但磁盘上不是目录：${file.path}`,
          file.path
        )
      );
    } else if (!file.directory && entry.state !== 'file') {
      checks.push(
        check(
          'warning',
          'LMCC_FILE_KIND',
          `声明为文件，但磁盘上不是普通文件：${file.path}`,
          file.path
        )
      );
    }
  }

  return checks;
}

async function promptChecks(question, entries, root) {
  const checks = [];
  const file = question.files[0];
  const entry = entries.find((item) => item.rel === file.path);
  const info = {
    archivePath: file.archivePath,
    minLength: file.minLength,
    maxLength: file.maxLength,
    length: null,
    size: null,
    preview: null,
  };

  if (!entry || entry.state !== 'file') return { checks, info };

  const read = await readQuestionText(root, file.path, MAX_ANSWER_READ_BYTES);
  if (!read.ok) {
    if (read.code === 'encoding') {
      checks.push(
        check(
          'error',
          'LMCC_PROMPT_ENCODING',
          'Prompt 文件必须是 UTF-8 编码的文本。',
          file.path
        )
      );
    }
    return { checks, info };
  }

  const text = String(read.content ?? '');
  const trimmed = text.trim();
  info.length = trimmed.length;
  info.size = read.size;
  info.preview = trimmed.slice(0, 280);

  if (trimmed.length < file.minLength) {
    checks.push(
      check(
        'error',
        'LMCC_PROMPT_MIN',
        `Prompt 至少需要 ${file.minLength} 字符（UTF-16）。`,
        file.path
      )
    );
  }
  if (trimmed.length > file.maxLength) {
    checks.push(
      check(
        'error',
        'LMCC_PROMPT_MAX',
        `Prompt 不能超过 ${file.maxLength} 字符（UTF-16）。`,
        file.path
      )
    );
  }

  if (question.id === PROMPT_EXAM_INFO_CLS_ID) {
    if (!trimmed) {
      checks.push(
        check(
          'error',
          'LMCC_PROMPT_EXAM_EMPTY',
          'Prompt 不能为空且不能超过 300 Token。',
          file.path
        )
      );
    }
    checks.push(
      check(
        'info',
        'LMCC_PROMPT_EXAM_TOKENS',
        '内置题型要求 ≤ 300 Token；这里没有 Qwen 分词器，未计算 Token 数。'
      )
    );
  }

  return { checks, info };
}

async function trainingChecks(question, entries, root) {
  const checks = [];
  const dataset = question.files.find(
    (file) => file.archivePath === 'dataset.jsonl'
  );
  const parameters = question.files.find(
    (file) => file.archivePath === 'training_params.json'
  );
  const statusOf = (file) =>
    entries.find((entry) => entry.rel === file?.path) || null;

  const datasetStatus = statusOf(dataset);
  if (dataset && datasetStatus?.state === 'file') {
    const read = await readQuestionText(
      root,
      dataset.path,
      MAX_ANSWER_READ_BYTES
    );
    if (!read.ok && read.code === 'encoding') {
      checks.push(
        check(
          'error',
          'LMCC_TRAINING_ENCODING',
          '训练数据须为 UTF-8 编码的 JSONL 文件。',
          dataset.path
        )
      );
    } else if (read.ok && !String(read.content ?? '').trim()) {
      checks.push(
        check(
          'error',
          'LMCC_TRAINING_EMPTY',
          '训练数据文件为空。',
          dataset.path
        )
      );
    }
  }

  const parameterStatus = statusOf(parameters);
  if (parameters && parameterStatus?.state === 'file') {
    const read = await readQuestionText(
      root,
      parameters.path,
      MAX_ANSWER_READ_BYTES
    );
    if (!read.ok && read.code === 'encoding') {
      checks.push(
        check(
          'error',
          'LMCC_TRAINING_PARAMS_JSON',
          '训练参数文件不是有效的 JSON。',
          parameters.path
        )
      );
    } else if (read.ok) {
      try {
        JSON.parse(String(read.content ?? ''));
      } catch {
        checks.push(
          check(
            'error',
            'LMCC_TRAINING_PARAMS_JSON',
            '训练参数文件不是有效的 JSON。',
            parameters.path
          )
        );
      }
    }
  }

  return checks;
}

/**
 * @param {object} parsed result of parseLmcc
 * @param {{filePath?: string, root?: string}} tab
 */
export async function loadQuestionAssets(parsed, tab) {
  const root = parsed.root || tab.root || dirnameOf(tab.filePath || '');
  const question = parsed.question;
  const rels = Array.from(
    new Set(question.files.map((file) => file.path).filter(Boolean))
  );

  const [statementResult, statsResult] = await Promise.all([
    readQuestionText(root, question.statement, MAX_STATEMENT_BYTES),
    statQuestionPaths(root, rels),
  ]);

  const statement = statementResult.ok
    ? {
        state: 'ready',
        text: statementResult.content,
        size: statementResult.size,
        message: null,
      }
    : {
        state: statementResult.code === 'missing' ? 'missing' : 'error',
        text: '',
        size: statementResult.size ?? null,
        message: statementResult.message || '题面无法读取。',
      };

  const entries = statsResult?.ok ? statsResult.entries : [];
  const checks = [];

  if (!statsResult?.ok) {
    checks.push(
      check(
        'info',
        'LMCC_STATS_UNAVAILABLE',
        statsResult?.message || '无法检查答案文件状态。'
      )
    );
  } else {
    checks.push(...collectFileStatusChecks(question, entries));
  }

  let promptInfo = null;

  if (parsed.type === 'prompt') {
    const result = await promptChecks(question, entries, root);
    checks.push(...result.checks);
    promptInfo = result.info;
  } else if (parsed.type === 'training') {
    checks.push(...(await trainingChecks(question, entries, root)));
  }

  return {
    status: 'ready',
    root,
    statement,
    entries,
    checks,
    promptInfo,
  };
}

export function describeStatus(entry) {
  if (!entry) return '未检查';
  switch (entry.state) {
    case 'file':
      return '文件';
    case 'directory':
      return '目录';
    case 'missing':
      return '缺失';
    case 'symlink':
      return '链接路径';
    case 'unsafe':
      return '路径无效';
    case 'io':
      return '无法访问';
    default:
      return '未知';
  }
}
