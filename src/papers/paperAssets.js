import { statQuestionPaths } from '../lmcc/questionAssets';

const MAX_PATHS = 1000;

function check(severity, code, message, field) {
  return { severity, code, message, field };
}

function collectPaths(paper) {
  const paths = new Set();
  let overflow = false;

  const add = (value) => {
    if (typeof value !== 'string' || !value) return;
    if (!paths.has(value)) paths.add(value);
  };

  for (const question of paper.questions) {
    if (!question.ok) continue;
    const parsed = question.parsed.question;
    add(parsed.statement);
    for (const file of parsed.files) add(file.path);
    add(parsed.evaluationCode);
    if (parsed.localTest) add(parsed.localTest.script);
    if (paths.size > MAX_PATHS) {
      overflow = true;
      break;
    }
  }

  return { paths: [...paths], overflow };
}

function checkStatement(question, entry) {
  if (!entry) return [];
  if (entry.state === 'missing') {
    return [
      check(
        'error',
        'PAPER_STATEMENT_MISSING',
        `题面文件不存在：${question.parsed.question.statement}`,
        question.fileName
      ),
    ];
  }
  if (entry.state === 'directory') {
    return [
      check(
        'error',
        'PAPER_STATEMENT_KIND',
        `题面路径是目录：${question.parsed.question.statement}`,
        question.fileName
      ),
    ];
  }
  if (entry.state === 'symlink') {
    return [
      check(
        'error',
        'PAPER_STATEMENT_SYMLINK',
        `不支持链接题面：${question.parsed.question.statement}`,
        question.fileName
      ),
    ];
  }
  if (entry.state === 'unsafe' || entry.state === 'io') {
    return [
      check(
        'error',
        'PAPER_STATEMENT_INACCESSIBLE',
        entry.message || `无法访问题面：${question.parsed.question.statement}`,
        question.fileName
      ),
    ];
  }
  return [];
}

function checkAnswerFiles(question, entries) {
  const checks = [];
  for (const file of question.parsed.question.files) {
    const entry = entries.get(file.path);
    if (!entry) continue;

    if (entry.state === 'missing') {
      checks.push(
        file.required
          ? check(
              'error',
              'PAPER_ANSWER_MISSING',
              `必需答案文件不存在：${file.path}`,
              question.fileName
            )
          : check(
              'info',
              'PAPER_ANSWER_OPTIONAL',
              `可选答案文件不存在：${file.path}`,
              question.fileName
            )
      );
    } else if (entry.state === 'symlink') {
      checks.push(
        check(
          'error',
          'PAPER_ANSWER_SYMLINK',
          `不支持链接答案路径：${file.path}`,
          question.fileName
        )
      );
    } else if (entry.state === 'unsafe' || entry.state === 'io') {
      checks.push(
        check(
          'error',
          'PAPER_ANSWER_INACCESSIBLE',
          entry.message || `无法访问答案路径：${file.path}`,
          question.fileName
        )
      );
    } else if (file.directory && entry.state !== 'directory') {
      checks.push(
        check(
          'warning',
          'PAPER_ANSWER_KIND',
          `声明为答案目录，但磁盘上不是目录：${file.path}`,
          question.fileName
        )
      );
    } else if (!file.directory && entry.state !== 'file') {
      checks.push(
        check(
          'warning',
          'PAPER_ANSWER_KIND',
          `声明为答案文件，但磁盘上不是普通文件：${file.path}`,
          question.fileName
        )
      );
    }
  }
  return checks;
}

function checkReferencedFiles(question, entries) {
  const checks = [];
  const targets = [];
  if (question.parsed.question.evaluationCode) {
    targets.push(['evaluationCode', question.parsed.question.evaluationCode]);
  }
  if (question.parsed.question.localTest?.script) {
    targets.push(['localTest', question.parsed.question.localTest.script]);
  }

  for (const [field, target] of targets) {
    const entry = entries.get(target);
    if (!entry) continue;
    if (entry.state === 'missing') {
      checks.push(
        check(
          'warning',
          'PAPER_REFERENCED_MISSING',
          `引用的评测文件不存在：${target}`,
          question.fileName
        )
      );
    } else if (entry.state === 'symlink') {
      checks.push(
        check(
          'error',
          'PAPER_REFERENCED_SYMLINK',
          `不支持链接评测文件：${target}`,
          question.fileName
        )
      );
    } else if (entry.state !== 'file') {
      checks.push(
        check(
          'warning',
          'PAPER_REFERENCED_KIND',
          `${field} 指向的不是普通文件：${target}`,
          question.fileName
        )
      );
    }
  }
  return checks;
}

/**
 * Stat every statement / answer / referenced evaluation file in one batch.
 * This gives the overview real existence checks without opening each reader.
 */
export async function loadPaperStatus(paper) {
  if (!paper?.recognized) {
    return { status: 'skipped', checks: new Map() };
  }

  const { paths, overflow } = collectPaths(paper);
  if (overflow) {
    return {
      status: 'skipped',
      checks: new Map(),
      message: `路径超过 ${MAX_PATHS} 个，已跳过文件存在性检查。`,
    };
  }
  if (paths.length === 0) {
    return { status: 'ready', checks: new Map(), entries: new Map() };
  }

  let result;
  try {
    result = await statQuestionPaths(paper.root, paths);
  } catch {
    return {
      status: 'error',
      checks: new Map(),
      message: '无法检查试卷文件状态。',
    };
  }

  if (!result?.ok) {
    return {
      status: 'unsupported',
      checks: new Map(),
      message: result?.message || '当前环境不支持检查试卷文件状态。',
    };
  }

  const entries = new Map(
    (result.entries || []).map((entry) => [entry.rel, entry])
  );
  const checks = new Map();
  for (const question of paper.questions) {
    if (!question.ok) continue;
    const list = [
      ...checkStatement(question, entries.get(question.parsed.question.statement)),
      ...checkAnswerFiles(question, entries),
      ...checkReferencedFiles(question, entries),
    ];
    if (list.length > 0) checks.set(question.filePath, list);
  }

  return { status: 'ready', checks, entries };
}
