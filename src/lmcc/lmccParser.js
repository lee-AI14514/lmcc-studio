/**
 * `.lmcc` question file parser.
 *
 * Implements the format documented in LMCC-FILE-FORMAT.md:
 *
 *   raw text
 *     -> strip leading U+FEFF
 *     -> CRLF => LF
 *     -> require "LMCC/1\n"
 *     -> JSON.parse(rest)
 *     -> top level -> files -> type rules -> inputs -> extras
 *     -> path rules (safeName / answerPath)
 *
 * The parser never touches the filesystem. It validates the declaration and
 * reports path problems as issues so the reader can still show the question.
 */

export const LMCC_MAGIC = 'LMCC/1';
export const LMCC_HEADER = 'LMCC/1\n';
export const LMCC_HEADER_LENGTH = LMCC_HEADER.length; // 7

export const QUESTION_TYPES = ['files', 'agent', 'training', 'prompt'];
export const DEFAULT_QUESTION_TYPE = 'files';

export const PROMPT_TOKENIZER = 'glm4-bd8234fe';
export const PROMPT_EXAM_INFO_CLS_ID = 'lmcc-exam-info-cls';

export const LIMITS = {
  maxFiles: 1000,
  maxInputs: 100,
  maxInputFields: 100,
  maxPathLength: 512,
  maxAnswerBytes: 10 * 1024 * 1024,
};

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
const HOME_STATEMENT_PATTERN = /^\.lmcc\/([A-Za-z0-9_-]+)\/statement\.md$/;
const WINDOWS_RESERVED_PATTERN =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// The format rejects C0 control characters; this rule is intentional.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_PATH_CHARS = /[\x00-\x1f<>:"|?*\\]/;
const UPLOAD_EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/;
const PARAMETER_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const RESERVED_ANSWER_PATTERNS = [
  /^\.lmcc\/(?:[^/]+\/)?(?:git|history|tmp)(?:\/|$)/i,
  /^\.lmcc\/(?:[^/]+\/)?(?:session\.json|runtime\.json)$/i,
];

const TYPE_LABELS = {
  files: '文件题',
  prompt: '提示词题',
  training: '训练题',
  agent: '智能体题',
};

export class LmccParseError extends Error {
  constructor(message, { code = 'LMCC_INVALID', detail = null } = {}) {
    super(message);
    this.name = 'LmccParseError';
    this.code = code;
    this.detail = detail;
  }
}

export function typeLabel(type) {
  return TYPE_LABELS[type] || type || '未知题型';
}

export function questionType(value) {
  return QUESTION_TYPES.includes(value) ? value : DEFAULT_QUESTION_TYPE;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Strip a leading UTF-8 BOM and normalise CRLF line endings.
 * A lone CR is intentionally left untouched (matches the runtime).
 */
export function normalizeLmccText(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
}

/**
 * safeName(rel) from the format: the first gate for every relative path.
 */
export function isSafeName(rel) {
  if (typeof rel !== 'string') return false;
  if (rel.length < 1 || rel.length > LIMITS.maxPathLength) return false;
  if (rel !== rel.normalize('NFC')) return false;
  if (FORBIDDEN_PATH_CHARS.test(rel)) return false;

  const segments = rel.split('/');
  for (const segment of segments) {
    if (!segment) return false;
    if (segment === '.' || segment === '..') return false;
    if (segment.endsWith('.') || segment.endsWith(' ')) return false;
    if (segment.toLowerCase() === '.git') return false;
    if (WINDOWS_RESERVED_PATTERN.test(segment)) return false;
  }
  return true;
}

/**
 * answerPath(rel): safeName plus the framework-reserved `.lmcc` areas.
 */
export function isAnswerPath(rel) {
  if (!isSafeName(rel)) return false;
  if (rel.toLowerCase() === '.lmcc') return false;
  return !RESERVED_ANSWER_PATTERNS.some((pattern) => pattern.test(rel));
}

function safeNameError(rel) {
  return new LmccParseError(`不支持的相对文件路径：${rel}`, {
    code: 'LMCC_PATH',
    detail: { path: rel },
  });
}

function jsonErrorDetail(error, jsonText) {
  const reason = String(error?.message || error || 'JSON 解析失败');
  const detail = { reason, offset: null, line: null, column: null };

  const positionMatch = reason.match(/position\s+(\d+)/i);
  if (positionMatch) {
    const offset = Number(positionMatch[1]);
    if (Number.isInteger(offset) && offset >= 0 && offset <= jsonText.length) {
      detail.offset = offset;
      const before = jsonText.slice(0, offset);
      detail.line = before.split('\n').length;
      detail.column = offset - before.lastIndexOf('\n');
    }
  }

  const lineColumnMatch = reason.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColumnMatch) {
    detail.line = Number(lineColumnMatch[1]);
    detail.column = Number(lineColumnMatch[2]);
  }

  return detail;
}

/**
 * Resolve the question home from the statement path (spec §7.4).
 */
export function resolveQuestionHome(statement) {
  const match = typeof statement === 'string'
    ? HOME_STATEMENT_PATTERN.exec(statement)
    : null;
  if (!match) {
    return { home: '', statementInHome: false, homeId: null };
  }
  return {
    home: `.lmcc/${match[1]}`,
    statementInHome: true,
    homeId: match[1],
  };
}

function normalizeFileEntry(file) {
  return {
    ...file,
    path: file.path,
    archivePath: file.archivePath,
    directory: file.directory === true,
    required: file.required !== false,
    minLength: file.minLength === undefined ? 0 : file.minLength,
    maxLength: file.maxLength,
  };
}

function validateFilesArray(raw) {
  const files = raw.files;
  if (
    !Array.isArray(files) ||
    (!files.length && raw.type !== 'agent') ||
    files.length > LIMITS.maxFiles ||
    files.some(
      (file) =>
        !file ||
        typeof file !== 'object' ||
        Array.isArray(file) ||
        typeof file.path !== 'string' ||
        !file.path ||
        typeof file.archivePath !== 'string' ||
        !file.archivePath ||
        (file.directory !== undefined && typeof file.directory !== 'boolean') ||
        (file.required !== undefined && typeof file.required !== 'boolean')
    )
  ) {
    throw new LmccParseError('请声明需要提交的答案文件。', {
      code: 'LMCC_FILES',
    });
  }
  return files.map(normalizeFileEntry);
}

function validatePromptLimit(promptLimit, resolvedType) {
  if (promptLimit === undefined) return;
  if (
    resolvedType !== 'prompt' ||
    !isPlainObject(promptLimit) ||
    promptLimit.tokenizer !== PROMPT_TOKENIZER ||
    !Number.isInteger(promptLimit.maxTokens) ||
    promptLimit.maxTokens < 1
  ) {
    throw new LmccParseError('Prompt Token 限制配置无效。', {
      code: 'LMCC_PROMPT_LIMIT',
    });
  }
}

function validatePromptFiles(files) {
  const file = files[0];
  const minLength = file?.minLength;
  const maxLength = file?.maxLength;
  if (
    files.length !== 1 ||
    !file ||
    file.directory === true ||
    !Number.isInteger(minLength) ||
    minLength < 0 ||
    !Number.isInteger(maxLength) ||
    maxLength < minLength
  ) {
    throw new LmccParseError('Prompt 题必须声明一个答案文件及有效的长度限制。', {
      code: 'LMCC_PROMPT_FILES',
    });
  }
}

function validateTrainingFiles(files) {
  const dataset = files.find((file) => file.archivePath === 'dataset.jsonl');
  const parameters = files.find(
    (file) => file.archivePath === 'training_params.json'
  );
  if (
    files.length !== 2 ||
    !dataset ||
    !parameters ||
    files.some((file) => file.directory || file.required === false) ||
    dataset.path === parameters.path
  ) {
    throw new LmccParseError(
      '训练题须声明 dataset.jsonl 和 training_params.json 两个必需的普通答案文件。',
      { code: 'LMCC_TRAINING_FILES' }
    );
  }
}

function invalidInputs(message = '作答项配置无效。') {
  return new LmccParseError(message, { code: 'LMCC_INPUTS' });
}

function normalizeParameterField(field) {
  return {
    ...field,
    key: field.key,
    label: field.label,
    type: field.type,
    min: field.min,
    max: field.max,
    default: field.default,
    options: field.options,
  };
}

function validateParameterField(field, seenKeys) {
  if (!isPlainObject(field)) throw invalidInputs('参数字段配置无效。');

  const { key, label, type, min, max, default: defaultValue, options } = field;

  if (
    typeof key !== 'string' ||
    !PARAMETER_KEY_PATTERN.test(key) ||
    key === 'constructor' ||
    key === 'prototype'
  ) {
    throw invalidInputs('参数字段配置无效。');
  }
  if (seenKeys.has(key)) throw invalidInputs('参数字段配置无效。');
  seenKeys.add(key);

  if (!isNonEmptyString(label)) throw invalidInputs('参数字段配置无效。');
  if (!['number', 'integer', 'boolean'].includes(type)) {
    throw invalidInputs('参数字段配置无效。');
  }

  if (type === 'boolean') {
    if (min !== undefined || max !== undefined || options !== undefined) {
      throw invalidInputs('开关配置无效。');
    }
    if (defaultValue !== undefined && typeof defaultValue !== 'boolean') {
      throw invalidInputs('开关配置无效。');
    }
    return normalizeParameterField(field);
  }

  if (min !== undefined && (typeof min !== 'number' || !Number.isFinite(min))) {
    throw invalidInputs('参数字段配置无效。');
  }
  if (max !== undefined && (typeof max !== 'number' || !Number.isFinite(max))) {
    throw invalidInputs('参数字段配置无效。');
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw invalidInputs('参数字段配置无效。');
  }
  if (type === 'integer') {
    if (min !== undefined && !Number.isInteger(min)) {
      throw invalidInputs('参数字段配置无效。');
    }
    if (max !== undefined && !Number.isInteger(max)) {
      throw invalidInputs('参数字段配置无效。');
    }
  }

  if (options !== undefined) {
    if (
      !Array.isArray(options) ||
      options.length === 0 ||
      options.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw invalidInputs('参数字段配置无效。');
    }
    if (type === 'integer' && options.some((value) => !Number.isInteger(value))) {
      throw invalidInputs('参数字段配置无效。');
    }
    for (const value of options) {
      if (min !== undefined && value < min) throw invalidInputs('参数字段配置无效。');
      if (max !== undefined && value > max) throw invalidInputs('参数字段配置无效。');
    }
  }

  if (defaultValue !== undefined) {
    if (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)) {
      throw invalidInputs('参数字段配置无效。');
    }
    if (type === 'integer' && !Number.isInteger(defaultValue)) {
      throw invalidInputs('参数字段配置无效。');
    }
    if (min !== undefined && defaultValue < min) {
      throw invalidInputs('参数默认值超出范围。');
    }
    if (max !== undefined && defaultValue > max) {
      throw invalidInputs('参数默认值超出范围。');
    }
    if (options !== undefined && !options.includes(defaultValue)) {
      throw invalidInputs('参数默认值超出范围。');
    }
  }

  return normalizeParameterField(field);
}

function validateInputs(inputs, files) {
  if (
    !Array.isArray(inputs) ||
    inputs.length < 1 ||
    inputs.length > LIMITS.maxInputs
  ) {
    throw invalidInputs();
  }

  const fileByArchive = new Map(
    files
      .filter((file) => !file.directory)
      .map((file) => [file.archivePath, file])
  );
  const usedArchivePaths = new Set();
  const normalized = [];

  for (const input of inputs) {
    if (!isPlainObject(input)) throw invalidInputs();
    const { kind, file, label } = input;

    if (!['file', 'upload', 'parameters'].includes(kind)) throw invalidInputs();
    if (typeof file !== 'string' || !file) throw invalidInputs();
    if (!isNonEmptyString(label)) throw invalidInputs();

    if (!fileByArchive.has(file)) {
      throw invalidInputs('作答项必须关联唯一的普通答案文件。');
    }
    if (usedArchivePaths.has(file)) {
      throw invalidInputs('作答项必须关联唯一的普通答案文件。');
    }
    usedArchivePaths.add(file);

    if (kind === 'file') {
      if (input.preview !== undefined && typeof input.preview !== 'boolean') {
        throw invalidInputs();
      }
      normalized.push({
        kind,
        file,
        label,
        preview: input.preview === true,
      });
      continue;
    }

    if (kind === 'upload') {
      const extensions = input.extensions;
      if (
        !Array.isArray(extensions) ||
        extensions.length === 0 ||
        extensions.some(
          (extension) =>
            typeof extension !== 'string' ||
            !UPLOAD_EXTENSION_PATTERN.test(extension)
        )
      ) {
        throw invalidInputs('上传文件类型配置无效。');
      }
      if (input.format !== undefined) {
        if (
          input.format !== 'jsonl' ||
          extensions.length !== 1 ||
          extensions[0] !== 'jsonl'
        ) {
          throw invalidInputs('上传文件类型配置无效。');
        }
      }
      normalized.push({
        kind,
        file,
        label,
        extensions: [...extensions],
        format: input.format === 'jsonl' ? 'jsonl' : undefined,
      });
      continue;
    }

    if (
      !Array.isArray(input.fields) ||
      input.fields.length < 1 ||
      input.fields.length > LIMITS.maxInputFields
    ) {
      throw invalidInputs('作答项类型或参数配置无效。');
    }
    const seenKeys = new Set();
    const fields = input.fields.map((field) =>
      validateParameterField(field, seenKeys)
    );
    normalized.push({ kind, file, label, fields });
  }

  return normalized;
}

function collectPathIssues(question) {
  const issues = [];

  for (const [index, file] of question.files.entries()) {
    if (!isSafeName(file.path)) {
      issues.push({
        severity: 'error',
        code: 'LMCC_PATH',
        message: `不支持的相对文件路径：${file.path}`,
        field: `files[${index}].path`,
        path: file.path,
      });
    } else if (!isAnswerPath(file.path)) {
      issues.push({
        severity: 'error',
        code: 'LMCC_ANSWER_PATH',
        message: '答案路径不能包含框架配置或历史目录。',
        field: `files[${index}].path`,
        path: file.path,
      });
    }

    if (!isSafeName(file.archivePath)) {
      issues.push({
        severity: 'error',
        code: 'LMCC_PATH',
        message: `不支持的相对文件路径：${file.archivePath}`,
        field: `files[${index}].archivePath`,
        path: file.archivePath,
      });
    }
  }

  if (question.evaluationCode !== null && !isSafeName(question.evaluationCode)) {
    issues.push({
      severity: 'error',
      code: 'LMCC_PATH',
      message: `不支持的相对文件路径：${question.evaluationCode}`,
      field: 'evaluationCode',
      path: question.evaluationCode,
    });
  }

  if (
    question.localTest !== null &&
    !isSafeName(question.localTest.script)
  ) {
    issues.push({
      severity: 'error',
      code: 'LMCC_PATH',
      message: `不支持的相对文件路径：${question.localTest.script}`,
      field: 'localTest.script',
      path: question.localTest.script,
    });
  }

  const duplicate = findDuplicateDeclarations(question.files);
  if (duplicate) {
    issues.push({
      severity: 'warning',
      code: 'LMCC_DUPLICATE',
      message: '答案文件声明存在重复或重叠。',
      field: 'files',
    });
  }

  return issues;
}

/**
 * Case-insensitive duplicate / directory-file overlap check for source and
 * archive paths (spec §4 / §8).
 */
export function findDuplicateDeclarations(files) {
  for (const key of ['path', 'archivePath']) {
    const entries = files.map((file) => ({
      value: String(file[key]).toLowerCase(),
    }));
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = 0; j < entries.length; j += 1) {
        if (i === j) continue;
        const left = entries[i];
        const right = entries[j];
        if (left.value === right.value) return true;
        // A declared file cannot also be an ancestor/descendant of another
        // declaration: recursive collection would emit the same entry twice.
        if (right.value.startsWith(`${left.value}/`)) return true;
      }
    }
  }
  return false;
}

function collectTypeIssues(question) {
  const issues = [];

  if (question.type === 'prompt') {
    const file = question.files[0];
    if (
      question.id === PROMPT_EXAM_INFO_CLS_ID &&
      file &&
      file.archivePath !== 'system_prompt.txt'
    ) {
      issues.push({
        severity: 'error',
        code: 'LMCC_PROMPT_EXAM',
        message: `内置题型 ${PROMPT_EXAM_INFO_CLS_ID} 的答案文件 archivePath 必须是 system_prompt.txt。`,
        field: 'files[0].archivePath',
      });
    }
  }

  return issues;
}

/**
 * Parse and validate one `.lmcc` document.
 *
 * @param {string} text raw file content
 * @param {{root?: string | null}} [options]
 * @returns {object} parsed question
 * @throws {LmccParseError} when the document is structurally unusable
 */
export function parseLmcc(text, options = {}) {
  const warnings = [];
  const normalizedText = normalizeLmccText(text);

  if (!normalizedText.startsWith(LMCC_HEADER)) {
    throw new LmccParseError('无效的 LMCC 题目文件：需要 LMCC/1 格式标识。', {
      code: 'LMCC_MAGIC',
      detail: { firstLine: normalizedText.split('\n', 1)[0] || '' },
    });
  }

  const jsonText = normalizedText.slice(LMCC_HEADER_LENGTH);
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (error) {
    throw new LmccParseError('题目内容无法解析，请检查题目文件是否完整。', {
      code: 'LMCC_JSON',
      detail: jsonErrorDetail(error, jsonText),
    });
  }

  // ---- top level ---------------------------------------------------------
  if (
    !isPlainObject(raw) ||
    !ID_PATTERN.test(raw.id ?? '') ||
    !isNonEmptyString(raw.type) ||
    !isNonEmptyString(raw.title) ||
    !isNonEmptyString(raw.statement)
  ) {
    throw new LmccParseError('题目配置不完整。', { code: 'LMCC_CONFIG' });
  }

  const declaredType = raw.type;
  const type = questionType(declaredType);
  if (type !== declaredType) {
    warnings.push({
      code: 'LMCC_UNKNOWN_TYPE',
      message: `未知题型 “${declaredType}”，按 files 题处理。`,
    });
  }

  // ---- files -------------------------------------------------------------
  const files = validateFilesArray(raw);

  // ---- prompt limit ------------------------------------------------------
  validatePromptLimit(raw.promptLimit, type);

  // ---- type specific -----------------------------------------------------
  if (type === 'prompt') {
    validatePromptFiles(files);
  } else if (type === 'agent') {
    if (files.length !== 0 || raw.localTest) {
      throw new LmccParseError(
        'Agent 题通过聊天生成代码，不声明本地答案或本地评测。',
        { code: 'LMCC_AGENT' }
      );
    }
  } else if (type === 'training') {
    validateTrainingFiles(files);
  }

  // ---- inputs ------------------------------------------------------------
  let inputs = null;
  if (raw.inputs !== undefined) {
    if (type !== 'files') {
      throw new LmccParseError('可配置作答项须使用 files 题型。', {
        code: 'LMCC_INPUTS_TYPE',
      });
    }
    inputs = validateInputs(raw.inputs, files);
  }

  // ---- remaining configuration ------------------------------------------
  if (raw.localTest !== undefined) {
    if (
      !isPlainObject(raw.localTest) ||
      !isNonEmptyString(raw.localTest.script)
    ) {
      throw new LmccParseError('本地评测配置无效。', {
        code: 'LMCC_LOCAL_TEST',
      });
    }
  }

  if (raw.remoteDebug !== undefined && typeof raw.remoteDebug !== 'boolean') {
    throw new LmccParseError('远端调试配置无效。', {
      code: 'LMCC_REMOTE_DEBUG',
    });
  }

  if (raw.evaluationCode !== undefined && !isNonEmptyString(raw.evaluationCode)) {
    throw new LmccParseError('评测代码路径配置无效。', {
      code: 'LMCC_EVALUATION_CODE',
    });
  }

  if (raw.submission !== undefined) {
    if (
      !isPlainObject(raw.submission) ||
      !isNonEmptyString(raw.submission.endpoints)
    ) {
      throw new LmccParseError('提交接口配置无效。', {
        code: 'LMCC_SUBMISSION',
      });
    }
  }

  // ---- path rules --------------------------------------------------------
  if (!isSafeName(raw.statement)) {
    throw safeNameError(raw.statement);
  }

  const home = resolveQuestionHome(raw.statement);
  const question = {
    type,
    declaredType,
    id: String(raw.id),
    title: raw.title,
    statement: raw.statement,
    files,
    inputs,
    promptLimit: raw.promptLimit === undefined ? null : raw.promptLimit,
    evaluationCode:
      raw.evaluationCode === undefined ? null : raw.evaluationCode,
    localTest: raw.localTest === undefined ? null : raw.localTest,
    submission: raw.submission === undefined ? null : raw.submission,
    remoteDebug: raw.remoteDebug,
  };

  const issues = [...collectPathIssues(question), ...collectTypeIssues(question)];

  for (const warning of warnings) {
    issues.push({ severity: 'info', ...warning });
  }

  if (type === 'prompt' && question.promptLimit) {
    issues.push({
      severity: 'info',
      code: 'LMCC_TOKENIZER',
      message:
        'Prompt Token 上限依赖内置 GLM-4 tokenizer，这里只展示配置，不做 Token 计数。',
    });
  }

  return {
    question,
    raw,
    type,
    declaredType,
    root: options.root ?? null,
    json: {
      text: jsonText,
      offset: LMCC_HEADER_LENGTH,
      length: jsonText.length,
    },
    source: {
      text: normalizedText,
      length: normalizedText.length,
    },
    paths: {
      statement: raw.statement,
      home: home.home,
      statementInHome: home.statementInHome,
      homeId: home.homeId,
    },
    issues,
    warnings,
    meta: {
      fileCount: files.length,
      answerFileCount: files.filter((file) => !file.directory).length,
      inputCount: inputs ? inputs.length : 0,
      maxFileBytes: LIMITS.maxAnswerBytes,
    },
  };
}

export function findFileByArchivePath(question, archivePath) {
  return (
    question.files.find((file) => file.archivePath === archivePath) || null
  );
}
