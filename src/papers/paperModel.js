import { parseLmcc } from '../lmcc/lmccParser';

/**
 * Turn the raw paper snapshot produced by the main process into the shape the
 * paper overview uses.
 *
 * The main process only reads bytes; every `.lmcc` document is parsed here so
 * a paper and a standalone question always follow exactly the same rules.
 */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function issue(severity, code, message, field) {
  return { severity, code, message, field };
}

function parseQuestionEntry(entry, paperRoot) {
  if (entry.readError) {
    return {
      ...entry,
      ok: false,
      parsed: null,
      error: {
        code: 'PAPER_QUESTION_READ',
        message: entry.readError,
        detail: null,
      },
    };
  }

  try {
    const parsed = parseLmcc(entry.content, { root: paperRoot });
    return { ...entry, ok: true, parsed, error: null };
  } catch (error) {
    return {
      ...entry,
      ok: false,
      parsed: null,
      error: {
        code: error?.code || 'LMCC_INVALID',
        message: error?.message || '题目文件无法解析。',
        detail: error?.detail || null,
      },
    };
  }
}

function parseMeta(raw, label, codePrefix) {
  if (!raw || raw.state === 'missing' || raw.state === 'unavailable') {
    return { state: 'missing', value: null, text: null, message: null };
  }
  if (raw.state === 'error') {
    return {
      state: 'error',
      value: null,
      text: null,
      message: raw.message || `无法读取 ${label}。`,
    };
  }

  try {
    return {
      state: 'ready',
      value: JSON.parse(String(raw.text ?? '').replace(/^\uFEFF/, '')),
      text: raw.text,
      message: null,
    };
  } catch (error) {
    return {
      state: 'invalid',
      value: null,
      text: raw.text,
      message: `${label} 不是有效的 JSON。`,
      code: `${codePrefix}_INVALID`,
    };
  }
}

function buildRuntime(raw) {
  const meta = parseMeta(raw, '.lmcc/runtime.json', 'PAPER_RUNTIME');
  if (meta.state === 'missing') return meta;
  if (meta.state !== 'ready') return meta;

  if (!isPlainObject(meta.value)) {
    return {
      ...meta,
      state: 'invalid',
      message: '.lmcc/runtime.json 的内容必须是 JSON 对象。',
    };
  }

  const runtimeId =
    typeof meta.value.runtimeId === 'string' ? meta.value.runtimeId.trim() : '';
  const capabilities = isPlainObject(meta.value.capabilities)
    ? meta.value.capabilities
    : null;

  return {
    ...meta,
    runtimeId,
    capabilities,
    missingRuntimeId: !runtimeId,
    invalidCapabilities:
      meta.value.capabilities !== undefined && !capabilities,
  };
}

function buildContest(raw) {
  const meta = parseMeta(raw, '.lmcc/contest.json', 'PAPER_CONTEST');
  if (meta.state !== 'ready') return meta;
  if (!isPlainObject(meta.value)) {
    return {
      ...meta,
      state: 'invalid',
      message: '.lmcc/contest.json 的内容必须是 JSON 对象。',
    };
  }
  return {
    ...meta,
    filename:
      typeof meta.value.filename === 'string' ? meta.value.filename : null,
    username:
      typeof meta.value.username === 'string' ? meta.value.username : null,
    service:
      typeof meta.value.service === 'string' ? meta.value.service : null,
  };
}

function collectIssues(paper, questions) {
  const issues = (paper.warnings || []).map((warning) =>
    issue(
      warning.severity || 'warning',
      warning.code || 'PAPER_WARNING',
      warning.message || '试卷提示。'
    )
  );

  if (!paper.questions || paper.questions.length === 0) {
    issues.push(
      issue(
        'error',
        'PAPER_NO_QUESTIONS',
        '试卷根目录中没有 .lmcc 题目文件。'
      )
    );
  }

  const byId = new Map();
  for (const question of questions) {
    if (!question.ok) {
      issues.push(
        issue(
          'error',
          question.error.code,
          question.error.message,
          question.fileName
        )
      );
      continue;
    }

    const id = question.parsed.question.id;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(question);

    for (const questionIssue of question.parsed.issues || []) {
      issues.push({
        ...questionIssue,
        field: `${question.fileName} · ${questionIssue.field || '题目'}`,
        file: question.fileName,
      });
    }
  }

  for (const [id, duplicates] of byId) {
    if (duplicates.length < 2) continue;
    issues.push(
      issue(
        'warning',
        'PAPER_DUPLICATE_ID',
        `题目 id 重复：${id}（${duplicates
          .map((question) => question.fileName)
          .join('、')}），history/home 可能互相覆盖。`,
        'id'
      )
    );
  }

  // Two questions may not edit the same answer path (or a directory and one of
  // its files): each question is submitted separately and would collect the
  // other question's content too.
  const owners = new Map();
  const reported = new Set();
  for (const question of questions) {
    if (!question.ok) continue;
    for (const file of question.parsed.question.files) {
      const key = String(file.path).toLowerCase();
      let conflict = null;
      for (const [existing, owner] of owners) {
        if (owner === question.fileName) continue;
        if (
          key === existing ||
          key.startsWith(`${existing}/`) ||
          existing.startsWith(`${key}/`)
        ) {
          conflict = owner;
          break;
        }
      }
      if (conflict) {
        if (!reported.has(key)) {
          reported.add(key);
          issues.push(
            issue(
              'warning',
              'PAPER_ANSWER_OVERLAP',
              `题目答案路径存在重叠：${file.path}（${conflict} 与 ${question.fileName}）。`,
              file.path
            )
          );
        }
      } else {
        owners.set(key, question.fileName);
      }
    }
  }

  return issues;
}

function summarize(questions, issues) {
  const byType = { files: 0, prompt: 0, training: 0, agent: 0 };
  let answerFileCount = 0;

  for (const question of questions) {
    if (!question.ok) continue;
    const type = question.parsed.type;
    byType[type] = (byType[type] || 0) + 1;
    answerFileCount += question.parsed.question.files.length;
  }

  const errorCount = issues.filter((item) => item.severity === 'error').length;
  const warningCount = issues.filter(
    (item) => item.severity === 'warning'
  ).length;
  const validQuestions = questions.filter((question) => question.ok).length;

  return {
    total: questions.length,
    valid: validQuestions,
    invalid: questions.length - validQuestions,
    byType,
    answerFileCount,
    errorCount,
    warningCount,
    status:
      questions.length === 0 || validQuestions === 0
        ? 'error'
        : errorCount > 0
        ? 'error'
        : warningCount > 0
        ? 'warning'
        : 'ok',
  };
}

function emptyPaper(raw) {
  return {
    ...raw,
    recognized: false,
    questions: [],
    issues: [
      issue(
        'error',
        raw.code || 'PAPER_INVALID',
        raw.message || '试卷无法识别。'
      ),
    ],
    runtimeInfo: { state: 'unavailable', value: null },
    contestInfo: { state: 'unavailable', value: null },
    summary: {
      total: 0,
      valid: 0,
      invalid: 0,
      byType: {},
      answerFileCount: 0,
      errorCount: 1,
      warningCount: 0,
      status: 'error',
    },
    valid: false,
  };
}

export function buildPaper(raw) {
  if (!raw) return emptyPaper({});
  if (raw.ok === false) return emptyPaper(raw);

  const questions = (raw.questions || []).map((entry) =>
    parseQuestionEntry(entry, raw.root)
  );
  const issues = collectIssues(raw, questions);
  const runtimeInfo = buildRuntime(raw.runtime);
  const contestInfo = buildContest(raw.contest);

  if (runtimeInfo.state === 'missing') {
    issues.push(
      issue(
        'info',
        'PAPER_RUNTIME_MISSING',
        '未找到 .lmcc/runtime.json，本地评测不可用。'
      )
    );
  } else if (runtimeInfo.state !== 'ready') {
    issues.push(
      issue(
        'warning',
        runtimeInfo.code || 'PAPER_RUNTIME_INVALID',
        runtimeInfo.message || '.lmcc/runtime.json 配置无效。'
      )
    );
  } else {
    if (runtimeInfo.missingRuntimeId) {
      issues.push(
        issue(
          'error',
          'PAPER_RUNTIME_ID',
          '.lmcc/runtime.json 缺少 runtimeId。'
        )
      );
    }
    if (runtimeInfo.invalidCapabilities) {
      issues.push(
        issue(
          'warning',
          'PAPER_RUNTIME_CAPABILITIES',
          '.lmcc/runtime.json 的 capabilities 必须是对象。'
        )
      );
    }
  }

  if (contestInfo.state === 'missing') {
    issues.push(
      issue('info', 'PAPER_CONTEST_MISSING', '未找到 .lmcc/contest.json。')
    );
  } else if (contestInfo.state !== 'ready') {
    issues.push(
      issue(
        'warning',
        contestInfo.code || 'PAPER_CONTEST_INVALID',
        contestInfo.message || '.lmcc/contest.json 配置无效。'
      )
    );
  }

  const summary = summarize(questions, issues);
  const recognized = questions.length > 0;

  return {
    ...raw,
    recognized,
    questions,
    issues,
    runtimeInfo,
    contestInfo,
    summary,
    valid: recognized && summary.invalid === 0,
  };
}

export function paperRuntimeLabel(paper) {
  if (!paper?.recognized) return '未识别';
  if (paper.runtimeInfo?.state === 'missing') return '未配置 runtime';
  if (paper.runtimeInfo?.state !== 'ready') return 'runtime 无效';
  return paper.runtimeInfo.runtimeId || '未配置 runtimeId';
}

export function paperStatusLabel(paper) {
  if (!paper?.recognized) return '无法识别';
  if (paper.summary.status === 'error') return '存在问题';
  if (paper.summary.status === 'warning') return '有提示';
  return '结构有效';
}

export function paperStatusTone(paper) {
  if (!paper?.recognized) return 'error';
  return paper.summary.status === 'ok'
    ? 'ok'
    : paper.summary.status === 'warning'
    ? 'warning'
    : 'error';
}
