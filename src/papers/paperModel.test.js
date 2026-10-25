import { buildPaper, paperRuntimeLabel, paperStatusTone } from './paperModel';

function lmcc(value) {
  return `LMCC/1\n${JSON.stringify(value, null, 2)}`;
}

function question(fileName, value) {
  const content = lmcc(value);
  return {
    fileName,
    filePath: `/papers/demo/${fileName}`,
    size: content.length,
    content,
  };
}

function baseQuestion(overrides = {}) {
  return {
    type: 'files',
    id: 'q1',
    title: '示例题',
    statement: 'statement.md',
    files: [{ path: 'answer.txt', archivePath: 'answer.txt' }],
    ...overrides,
  };
}

function rawPaper(overrides = {}) {
  return {
    ok: true,
    id: 'demo',
    name: 'demo',
    path: '/papers/demo',
    root: '/papers/demo',
    nested: false,
    questions: [question('Q1.lmcc', baseQuestion())],
    runtime: { state: 'missing' },
    contest: { state: 'missing' },
    warnings: [],
    meta: { questionCount: 1, questionBytes: 100 },
    ...overrides,
  };
}

describe('paperModel', () => {
  test('builds a recognized paper from raw question files', () => {
    const paper = buildPaper(rawPaper());

    expect(paper.recognized).toBe(true);
    expect(paper.valid).toBe(true);
    expect(paper.questions).toHaveLength(1);
    expect(paper.questions[0].ok).toBe(true);
    expect(paper.questions[0].parsed.question.title).toBe('示例题');
    expect(paper.summary).toMatchObject({
      total: 1,
      valid: 1,
      invalid: 0,
      byType: { files: 1, prompt: 0, training: 0, agent: 0 },
      status: 'ok',
    });
    expect(paper.runtimeInfo.state).toBe('missing');
    expect(paper.contestInfo.state).toBe('missing');
    expect(paper.issues.some((item) => item.code === 'PAPER_RUNTIME_MISSING')).toBe(
      true
    );
    expect(paper.issues.some((item) => item.code === 'PAPER_CONTEST_MISSING')).toBe(
      true
    );
  });

  test('keeps a paper recognized when one question is malformed', () => {
    const bad = {
      fileName: 'Bad.lmcc',
      filePath: '/papers/demo/Bad.lmcc',
      size: 10,
      content: 'NOT-LMCC',
    };
    const paper = buildPaper(rawPaper({ questions: [bad] }));

    expect(paper.recognized).toBe(true);
    expect(paper.valid).toBe(false);
    expect(paper.summary.invalid).toBe(1);
    expect(paper.summary.status).toBe('error');
    expect(paper.issues.some((item) => item.severity === 'error')).toBe(true);
    expect(paper.questions[0].ok).toBe(false);
    expect(paper.questions[0].error.message).toContain('LMCC/1');
  });

  test('flags duplicate question ids without dropping either question', () => {
    const second = question('Q2.lmcc', baseQuestion());
    const paper = buildPaper(rawPaper({ questions: [question('Q1.lmcc', baseQuestion()), second] }));

    expect(paper.recognized).toBe(true);
    expect(paper.summary.total).toBe(2);
    expect(paper.summary.valid).toBe(2);
    expect(paper.summary.status).toBe('warning');
    expect(
      paper.issues.some((item) => item.code === 'PAPER_DUPLICATE_ID')
    ).toBe(true);
  });

  test('warns when two questions declare the same answer path', () => {
    const first = question(
      'Q1.lmcc',
      baseQuestion({
        id: 'q1',
        files: [{ path: 'shared.txt', archivePath: 'shared.txt' }],
      })
    );
    const second = question(
      'Q2.lmcc',
      baseQuestion({
        id: 'q2',
        files: [{ path: 'SHARED.txt', archivePath: 'shared.txt' }],
      })
    );
    const paper = buildPaper(rawPaper({ questions: [first, second] }));

    expect(paper.summary.status).toBe('warning');
    expect(
      paper.issues.some((item) => item.code === 'PAPER_ANSWER_OVERLAP')
    ).toBe(true);
  });

  test('parses runtime and contest metadata', () => {
    const paper = buildPaper(
      rawPaper({
        runtime: {
          state: 'ready',
          text: JSON.stringify({
            runtimeId: 'lmcc-python-3.12',
            capabilities: { localEvaluation: true, notebook: false },
          }),
        },
        contest: {
          state: 'ready',
          text: JSON.stringify({
            filename: 'demo',
            username: 'local',
            service: 'lmcc-studio',
          }),
        },
      })
    );

    expect(paper.runtimeInfo).toMatchObject({
      state: 'ready',
      runtimeId: 'lmcc-python-3.12',
      missingRuntimeId: false,
    });
    expect(paper.contestInfo).toMatchObject({
      state: 'ready',
      filename: 'demo',
      username: 'local',
      service: 'lmcc-studio',
    });
    expect(paperRuntimeLabel(paper)).toBe('lmcc-python-3.12');
    expect(paperStatusTone(paper)).toBe('ok');
    expect(
      paper.issues.some((item) => item.code === 'PAPER_RUNTIME_MISSING')
    ).toBe(false);
  });

  test('reports invalid metadata JSON', () => {
    const paper = buildPaper(
      rawPaper({
        runtime: { state: 'ready', text: '{not-json' },
        contest: { state: 'ready', text: '{not-json' },
      })
    );

    expect(paper.runtimeInfo.state).toBe('invalid');
    expect(paper.contestInfo.state).toBe('invalid');
    expect(paper.summary.status).toBe('warning');
    expect(
      paper.issues.some((item) => item.code === 'PAPER_RUNTIME_INVALID')
    ).toBe(true);
    expect(
      paper.issues.some((item) => item.code === 'PAPER_CONTEST_INVALID')
    ).toBe(true);
  });

  test('requires runtimeId when a runtime file is present', () => {
    const paper = buildPaper(
      rawPaper({
        runtime: {
          state: 'ready',
          text: JSON.stringify({ capabilities: {} }),
        },
      })
    );

    expect(paper.runtimeInfo.missingRuntimeId).toBe(true);
    expect(paper.summary.status).toBe('error');
    expect(paper.issues.some((item) => item.code === 'PAPER_RUNTIME_ID')).toBe(
      true
    );
  });

  test('represents an unrecognized folder as an error paper', () => {
    const paper = buildPaper({
      ok: false,
      code: 'PAPER_NO_QUESTIONS',
      message: '试卷根目录中没有 .lmcc 题目文件。',
      id: 'empty',
      name: 'empty',
      path: '/papers/empty',
    });

    expect(paper.recognized).toBe(false);
    expect(paper.valid).toBe(false);
    expect(paper.questions).toEqual([]);
    expect(paper.summary.status).toBe('error');
    expect(paper.issues[0].message).toBe('试卷根目录中没有 .lmcc 题目文件。');
    expect(paperStatusTone(paper)).toBe('error');
  });

  test('summarizes all four question types', () => {
    const questions = [
      question('T1.lmcc', baseQuestion({ id: 'q1', type: 'files' })),
      question(
        'T2.lmcc',
        {
          type: 'prompt',
          id: 'q2',
          title: 'Prompt',
          statement: 'T2.md',
          files: [
            {
              path: 'system_prompt.txt',
              archivePath: 'system_prompt.txt',
              minLength: 1,
              maxLength: 100,
            },
          ],
        }
      ),
      question('T3.lmcc', {
        type: 'training',
        id: 'q3',
        title: 'Training',
        statement: 'T3.md',
        files: [
          { path: 'dataset.jsonl', archivePath: 'dataset.jsonl' },
          {
            path: 'training_params.json',
            archivePath: 'training_params.json',
          },
        ],
      }),
      question('T4.lmcc', {
        type: 'agent',
        id: 'q4',
        title: 'Agent',
        statement: 'T4.md',
        files: [],
      }),
    ];
    const paper = buildPaper(rawPaper({ questions }));

    expect(paper.summary.byType).toEqual({
      files: 1,
      prompt: 1,
      training: 1,
      agent: 1,
    });
    expect(paper.summary.valid).toBe(4);
  });
});
