import {
  LMCC_MAGIC,
  isAnswerPath,
  isSafeName,
  parseLmcc,
  questionType,
  resolveQuestionHome,
  findDuplicateDeclarations,
  PROMPT_TOKENIZER,
} from './lmccParser';

function document(body) {
  return `${LMCC_MAGIC}\n${JSON.stringify(body, null, 2)}`;
}

function baseQuestion(overrides = {}) {
  return {
    type: 'files',
    id: 'demo-files',
    title: '多文件作答',
    statement: 'statement.md',
    files: [{ path: 'answer.py', archivePath: 'answer.py' }],
    ...overrides,
  };
}

function messageOf(fn) {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  throw new Error('expected the call to throw');
}

describe('parseLmcc — envelope', () => {
  test('parses a minimal files question', () => {
    const result = parseLmcc(document(baseQuestion()), { root: '/q' });
    expect(result.type).toBe('files');
    expect(result.question.id).toBe('demo-files');
    expect(result.question.title).toBe('多文件作答');
    expect(result.question.files[0]).toMatchObject({
      path: 'answer.py',
      archivePath: 'answer.py',
      directory: false,
      required: true,
      minLength: 0,
    });
    expect(result.issues).toEqual([]);
    expect(result.paths.home).toBe('');
    expect(result.root).toBe('/q');
  });

  test('strips a BOM and normalises CRLF', () => {
    const text = `\uFEFF${LMCC_MAGIC}\r\n${JSON.stringify(baseQuestion())}`;
    expect(parseLmcc(text).question.id).toBe('demo-files');
  });

  test('rejects a missing magic header', () => {
    expect(messageOf(() => parseLmcc(`{}\n`))).toBe(
      '无效的 LMCC 题目文件：需要 LMCC/1 格式标识。'
    );
  });

  test('rejects a magic header without a newline', () => {
    expect(messageOf(() => parseLmcc(`LMCC/1${JSON.stringify(baseQuestion())}`))).toBe(
      '无效的 LMCC 题目文件：需要 LMCC/1 格式标识。'
    );
  });

  test('tolerates blank lines after the header, like JSON.parse does', () => {
    // The format notes claim a blank line breaks parsing, but JSON.parse
    // skips leading whitespace, so the runtime accepts it.
    const result = parseLmcc(
      `LMCC/1\n\n${JSON.stringify(baseQuestion())}`
    );
    expect(result.question.id).toBe('demo-files');
  });

  test('reports invalid JSON with a detail object', () => {
    try {
      parseLmcc('LMCC/1\n{\n  "id": "x",\n}');
      throw new Error('expected failure');
    } catch (error) {
      expect(error.code).toBe('LMCC_JSON');
      expect(error.detail.reason).toEqual(expect.any(String));
      if (error.detail.line !== null) {
        expect(error.detail.line).toEqual(expect.any(Number));
      }
    }
  });

  test('accepts unknown top-level fields', () => {
    const result = parseLmcc(
      document(baseQuestion({ extra: { nested: true } }))
    );
    expect(result.raw.extra).toEqual({ nested: true });
  });
});

describe('parseLmcc — top level and files', () => {
  test.each([
    ['missing title', baseQuestion({ title: '' })],
    ['missing type', baseQuestion({ type: '   ' })],
    ['missing statement', baseQuestion({ statement: '' })],
    ['bad id characters', baseQuestion({ id: 'bad id' })],
    ['id too long', baseQuestion({ id: 'a'.repeat(101) })],
  ])('rejects an incomplete question: %s', (_label, body) => {
    expect(messageOf(() => parseLmcc(document(body)))).toBe(
      '题目配置不完整。'
    );
  });

  test('rejects a non-array files field', () => {
    expect(
      messageOf(() => parseLmcc(document(baseQuestion({ files: {} }))))
    ).toBe('请声明需要提交的答案文件。');
  });

  test('rejects an empty files field for non-agent questions', () => {
    expect(
      messageOf(() => parseLmcc(document(baseQuestion({ files: [] }))))
    ).toBe('请声明需要提交的答案文件。');
  });

  test('rejects an invalid file declaration', () => {
    expect(
      messageOf(() =>
        parseLmcc(
          document(
            baseQuestion({ files: [{ path: 'a.py' }] })
          )
        )
      )
    ).toBe('请声明需要提交的答案文件。');
  });

  test('rejects more than 1000 declared files', () => {
    const files = Array.from({ length: 1001 }, (_, index) => ({
      path: `f${index}.py`,
      archivePath: `f${index}.py`,
    }));
    expect(
      messageOf(() => parseLmcc(document(baseQuestion({ files }))))
    ).toBe('请声明需要提交的答案文件。');
  });

  test('accepts numeric ids like the runtime regex does', () => {
    const result = parseLmcc(document(baseQuestion({ id: 12345 })));
    expect(result.question.id).toBe('12345');
  });

  test('falls back to the files type for unknown types', () => {
    const result = parseLmcc(document(baseQuestion({ type: 'quiz' })));
    expect(result.type).toBe('files');
    expect(result.declaredType).toBe('quiz');
    expect(result.warnings[0].message).toContain('未知题型');
    expect(result.issues.some((issue) => issue.code === 'LMCC_UNKNOWN_TYPE')).toBe(
      true
    );
  });

  test('questionType maps unknown values to files', () => {
    expect(questionType('prompt')).toBe('prompt');
    expect(questionType('nope')).toBe('files');
    expect(questionType(undefined)).toBe('files');
  });
});

describe('parseLmcc — agent', () => {
  test('accepts an agent question with no files', () => {
    const result = parseLmcc(
      document({ type: 'agent', id: 'demo-agent', title: '智能体', statement: 'statement.md', files: [] })
    );
    expect(result.type).toBe('agent');
    expect(result.question.files).toEqual([]);
  });

  test('rejects files on an agent question', () => {
    expect(
      messageOf(() =>
        parseLmcc(
          document({
            type: 'agent',
            id: 'demo-agent',
            title: '智能体',
            statement: 'statement.md',
            files: [{ path: 'a.py', archivePath: 'a.py' }],
          })
        )
      )
    ).toBe('Agent 题通过聊天生成代码，不声明本地答案或本地评测。');
  });

  test('rejects localTest on an agent question', () => {
    expect(
      messageOf(() =>
        parseLmcc(
          document({
            type: 'agent',
            id: 'demo-agent',
            title: '智能体',
            statement: 'statement.md',
            files: [],
            localTest: { script: 'run.py' },
          })
        )
      )
    ).toBe('Agent 题通过聊天生成代码，不声明本地答案或本地评测。');
  });

  test('rejects inputs on an agent question', () => {
    expect(
      messageOf(() =>
        parseLmcc(
          document({
            type: 'agent',
            id: 'demo-agent',
            title: '智能体',
            statement: 'statement.md',
            files: [],
            inputs: [{ kind: 'file', file: 'a.py', label: 'A' }],
          })
        )
      )
    ).toBe('可配置作答项须使用 files 题型。');
  });
});

describe('parseLmcc — prompt', () => {
  const promptFiles = [
    { path: 'system_prompt.txt', archivePath: 'system_prompt.txt', minLength: 10, maxLength: 800 },
  ];

  function promptQuestion(overrides = {}) {
    return {
      type: 'prompt',
      id: 'demo-prompt',
      title: '提示词',
      statement: 'statement.md',
      files: promptFiles,
      ...overrides,
    };
  }

  test('accepts a prompt question with length limits', () => {
    const result = parseLmcc(document(promptQuestion()));
    expect(result.type).toBe('prompt');
    expect(result.question.files[0].minLength).toBe(10);
    expect(result.question.files[0].maxLength).toBe(800);
  });

  test('rejects two answer files', () => {
    const files = [
      ...promptFiles,
      { path: 'b.txt', archivePath: 'b.txt', maxLength: 10 },
    ];
    expect(
      messageOf(() => parseLmcc(document(promptQuestion({ files }))))
    ).toBe('Prompt 题必须声明一个答案文件及有效的长度限制。');
  });

  test('rejects a directory answer', () => {
    const files = [{ ...promptFiles[0], directory: true }];
    expect(
      messageOf(() => parseLmcc(document(promptQuestion({ files }))))
    ).toBe('Prompt 题必须声明一个答案文件及有效的长度限制。');
  });

  test('requires maxLength', () => {
    const files = [{ path: 'p.txt', archivePath: 'p.txt' }];
    expect(
      messageOf(() => parseLmcc(document(promptQuestion({ files }))))
    ).toBe('Prompt 题必须声明一个答案文件及有效的长度限制。');
  });

  test('rejects a maxLength below minLength', () => {
    const files = [
      { path: 'p.txt', archivePath: 'p.txt', minLength: 100, maxLength: 10 },
    ];
    expect(
      messageOf(() => parseLmcc(document(promptQuestion({ files }))))
    ).toBe('Prompt 题必须声明一个答案文件及有效的长度限制。');
  });

  test('validates promptLimit tokenizer and maxTokens', () => {
    const badTokenizer = promptQuestion({
      promptLimit: { tokenizer: 'other', maxTokens: 10 },
    });
    expect(messageOf(() => parseLmcc(document(badTokenizer)))).toBe(
      'Prompt Token 限制配置无效。'
    );

    const badMax = promptQuestion({
      promptLimit: { tokenizer: PROMPT_TOKENIZER, maxTokens: 0 },
    });
    expect(messageOf(() => parseLmcc(document(badMax)))).toBe(
      'Prompt Token 限制配置无效。'
    );

    const good = parseLmcc(
      document(
        promptQuestion({
          promptLimit: { tokenizer: PROMPT_TOKENIZER, maxTokens: 800 },
        })
      )
    );
    expect(good.question.promptLimit.maxTokens).toBe(800);
    expect(good.issues.some((issue) => issue.code === 'LMCC_TOKENIZER')).toBe(
      true
    );
  });

  test('rejects promptLimit on other question types', () => {
    expect(
      messageOf(() =>
        parseLmcc(
          document(
            baseQuestion({
              promptLimit: { tokenizer: PROMPT_TOKENIZER, maxTokens: 5 },
            })
          )
        )
      )
    ).toBe('Prompt Token 限制配置无效。');
  });

  test('flags the built-in prompt exam archive name', () => {
    const result = parseLmcc(
      document(
        promptQuestion({
          id: 'lmcc-exam-info-cls',
          files: [
            { path: 'p.txt', archivePath: 'p.txt', maxLength: 100 },
          ],
        })
      )
    );
    expect(
      result.issues.find((issue) => issue.code === 'LMCC_PROMPT_EXAM')
    ).toBeTruthy();
  });
});

describe('parseLmcc — training', () => {
  const trainingFiles = [
    { path: 'dataset.jsonl', archivePath: 'dataset.jsonl' },
    { path: 'training_params.json', archivePath: 'training_params.json' },
  ];

  function trainingQuestion(overrides = {}) {
    return {
      type: 'training',
      id: 'demo-training',
      title: '训练',
      statement: 'statement.md',
      files: trainingFiles,
      ...overrides,
    };
  }

  test('accepts the fixed training pair', () => {
    const result = parseLmcc(document(trainingQuestion()));
    expect(result.type).toBe('training');
    expect(result.question.files).toHaveLength(2);
  });

  test('rejects the wrong archive pair', () => {
    const files = [
      { path: 'a.jsonl', archivePath: 'a.jsonl' },
      { path: 'b.json', archivePath: 'b.json' },
    ];
    expect(
      messageOf(() => parseLmcc(document(trainingQuestion({ files }))))
    ).toBe(
      '训练题须声明 dataset.jsonl 和 training_params.json 两个必需的普通答案文件。'
    );
  });

  test('rejects optional or directory entries', () => {
    const files = [
      { ...trainingFiles[0], required: false },
      trainingFiles[1],
    ];
    expect(
      messageOf(() => parseLmcc(document(trainingQuestion({ files }))))
    ).toBe(
      '训练题须声明 dataset.jsonl 和 training_params.json 两个必需的普通答案文件。'
    );
  });

  test('rejects both declarations sharing a source path', () => {
    const files = [
      { path: 'shared.txt', archivePath: 'dataset.jsonl' },
      { path: 'shared.txt', archivePath: 'training_params.json' },
    ];
    expect(
      messageOf(() => parseLmcc(document(trainingQuestion({ files }))))
    ).toBe(
      '训练题须声明 dataset.jsonl 和 training_params.json 两个必需的普通答案文件。'
    );
  });
});

describe('parseLmcc — inputs', () => {
  function inputsQuestion(inputs, files) {
    return baseQuestion({
      files: files || [
        { path: 'submission.py', archivePath: 'submission.py' },
        { path: 'data.jsonl', archivePath: 'data.jsonl', required: false },
      ],
      inputs,
    });
  }

  test('normalises file, upload and parameters inputs', () => {
    const result = parseLmcc(
      document(
        inputsQuestion([
          { kind: 'file', file: 'submission.py', label: '提交代码', preview: true },
          {
            kind: 'upload',
            file: 'data.jsonl',
            label: '上传数据',
            extensions: ['jsonl'],
            format: 'jsonl',
          },
        ])
      )
    );
    expect(result.question.inputs).toHaveLength(2);
    expect(result.question.inputs[0]).toMatchObject({
      kind: 'file',
      preview: true,
    });
    expect(result.question.inputs[1]).toMatchObject({
      kind: 'upload',
      extensions: ['jsonl'],
      format: 'jsonl',
    });
  });

  test('rejects an empty inputs array', () => {
    expect(
      messageOf(() => parseLmcc(document(inputsQuestion([]))))
    ).toBe('作答项配置无效。');
  });

  test('rejects more than 100 inputs', () => {
    const inputs = Array.from({ length: 101 }, (_, index) => ({
      kind: 'file',
      file: 'submission.py',
      label: `L${index}`,
    }));
    expect(
      messageOf(() => parseLmcc(document(inputsQuestion(inputs))))
    ).toBe('作答项配置无效。');
  });

  test('rejects a reference to an undeclared archive path', () => {
    expect(
      messageOf(() =>
        parseLmcc(
          document(
            inputsQuestion([{ kind: 'file', file: 'missing.py', label: 'X' }])
          )
        )
      )
    ).toBe('作答项必须关联唯一的普通答案文件。');
  });

  test('rejects a directory archive path', () => {
    const files = [{ path: 'src', archivePath: 'src', directory: true }];
    expect(
      messageOf(() =>
        parseLmcc(
          document(
            inputsQuestion([{ kind: 'file', file: 'src', label: 'X' }], files)
          )
        )
      )
    ).toBe('作答项必须关联唯一的普通答案文件。');
  });

  test('rejects reusing one answer file', () => {
    expect(
      messageOf(() =>
        parseLmcc(
          document(
            inputsQuestion([
              { kind: 'file', file: 'submission.py', label: 'A' },
              { kind: 'file', file: 'submission.py', label: 'B' },
            ])
          )
        )
      )
    ).toBe('作答项必须关联唯一的普通答案文件。');
  });

  test('validates upload extensions and format', () => {
    expect(
      messageOf(() =>
        parseLmcc(
          document(
            inputsQuestion([
              {
                kind: 'upload',
                file: 'data.jsonl',
                label: 'U',
                extensions: ['JSONL'],
              },
            ])
          )
        )
      )
    ).toBe('上传文件类型配置无效。');

    expect(
      messageOf(() =>
        parseLmcc(
          document(
            inputsQuestion([
              {
                kind: 'upload',
                file: 'data.jsonl',
                label: 'U',
                extensions: ['json'],
                format: 'jsonl',
              },
            ])
          )
        )
      )
    ).toBe('上传文件类型配置无效。');
  });

  test('validates parameter fields', () => {
    const fieldsQuestion = (fields) =>
      inputsQuestion([
        { kind: 'parameters', file: 'data.jsonl', label: '参数', fields },
      ]);

    expect(
      messageOf(() =>
        parseLmcc(
          document(
            fieldsQuestion([
              { key: 'temperature', label: '温度', type: 'number', min: 0, max: 1, default: 2 },
            ])
          )
        )
      )
    ).toBe('参数默认值超出范围。');

    expect(
      messageOf(() =>
        parseLmcc(
          document(
            fieldsQuestion([
              { key: 'useCache', label: '缓存', type: 'boolean', min: 0 },
            ])
          )
        )
      )
    ).toBe('开关配置无效。');

    expect(
      messageOf(() =>
        parseLmcc(
          document(
            fieldsQuestion([
              { key: 'constructor', label: 'X', type: 'number' },
            ])
          )
        )
      )
    ).toBe('参数字段配置无效。');

    const valid = parseLmcc(
      document(
        fieldsQuestion([
          { key: 'steps', label: '步数', type: 'integer', min: 1, max: 10, default: 3, options: [1, 3, 5] },
        ])
      )
    );
    expect(valid.question.inputs[0].fields[0]).toMatchObject({
      key: 'steps',
      type: 'integer',
      default: 3,
    });
  });

  test('accepts boolean parameter fields with a default', () => {
    const result = parseLmcc(
      document(
        inputsQuestion([
          {
            kind: 'parameters',
            file: 'data.jsonl',
            label: '参数',
            fields: [
              { key: 'useFp16', label: 'FP16', type: 'boolean', default: true },
            ],
          },
        ])
      )
    );
    expect(result.question.inputs[0].fields[0].type).toBe('boolean');
  });

  test('rejects a non-boolean preview flag', () => {
    expect(
      messageOf(() =>
        parseLmcc(
          document(
            inputsQuestion([
              { kind: 'file', file: 'submission.py', label: 'A', preview: 'yes' },
            ])
          )
        )
      )
    ).toBe('作答项配置无效。');
  });
});

describe('parseLmcc — optional configuration', () => {
  test('validates localTest, remoteDebug, evaluationCode, submission', () => {
    expect(
      messageOf(() =>
        parseLmcc(document(baseQuestion({ localTest: { script: '' } })))
      )
    ).toBe('本地评测配置无效。');

    expect(
      messageOf(() =>
        parseLmcc(document(baseQuestion({ remoteDebug: 'yes' })))
      )
    ).toBe('远端调试配置无效。');

    expect(
      messageOf(() =>
        parseLmcc(document(baseQuestion({ evaluationCode: ' ' })))
      )
    ).toBe('评测代码路径配置无效。');

    expect(
      messageOf(() =>
        parseLmcc(document(baseQuestion({ submission: { endpoints: '' } })))
      )
    ).toBe('提交接口配置无效。');

    const result = parseLmcc(
      document(
        baseQuestion({
          localTest: { script: 'evaluate.py' },
          remoteDebug: false,
          evaluationCode: 'evaluate.py',
          submission: { endpoints: 'encrypted-blob' },
        })
      )
    );
    expect(result.question.remoteDebug).toBe(false);
    expect(result.question.localTest.script).toBe('evaluate.py');
  });
});

describe('path rules', () => {
  test.each([
    'answer.py',
    'src/main.py',
    '.lmcc/demo-files/statement.md',
    'a/b/c.txt',
  ])('isSafeName accepts %s', (value) => {
    expect(isSafeName(value)).toBe(true);
  });

  test.each([
    '',
    '../answer.py',
    'a/../b.py',
    '/absolute.py',
    'a\\b.py',
    'a:b.py',
    'a?.py',
    'a/.git/config',
    'a./b.py',
    'a /b.py',
    'CON',
    'com1.txt',
    'lpt9.log',
    'a\u0000b',
    'e\u0301.txt',
    `${'a'.repeat(513)}.py`,
  ])('isSafeName rejects %p', (value) => {
    expect(isSafeName(value)).toBe(false);
  });

  test.each([
    'answer.py',
    '.lmcc/demo-files/submission.py',
    '.lmcc/demo/statement.md',
  ])('isAnswerPath accepts %s', (value) => {
    expect(isAnswerPath(value)).toBe(true);
  });

  test.each([
    '.lmcc',
    '.LMCC',
    '.lmcc/history/a.json',
    '.lmcc/history',
    '.lmcc/demo/git/x',
    '.lmcc/demo/tmp',
    '.lmcc/session.json',
    '.lmcc/demo/runtime.json',
    '.lmcc/new/session.json',
  ])('isAnswerPath rejects %s', (value) => {
    expect(isAnswerPath(value)).toBe(false);
  });

  test('detects duplicate and overlapping declarations', () => {
    expect(
      findDuplicateDeclarations([
        { path: 'a.py', archivePath: 'a.py' },
        { path: 'A.py', archivePath: 'b.py' },
      ])
    ).toBe(true);

    expect(
      findDuplicateDeclarations([
        { path: 'src', archivePath: 'src', directory: true },
        { path: 'src/a.py', archivePath: 'src/a.py' },
      ])
    ).toBe(true);

    expect(
      findDuplicateDeclarations([
        { path: 'a.py', archivePath: 'a.py' },
        { path: 'b.py', archivePath: 'b.py' },
      ])
    ).toBe(false);
  });

  test('resolves the question home from the statement path', () => {
    expect(resolveQuestionHome('.lmcc/demo-files/statement.md')).toEqual({
      home: '.lmcc/demo-files',
      statementInHome: true,
      homeId: 'demo-files',
    });
    expect(resolveQuestionHome('statement.md').home).toBe('');
  });

  test('rejects an unsafe statement path', () => {
    expect(
      messageOf(() =>
        parseLmcc(document(baseQuestion({ statement: '../statement.md' })))
      )
    ).toBe('不支持的相对文件路径：../statement.md');
  });

  test('reports answer path issues without blocking the parse', () => {
    const result = parseLmcc(
      document(
        baseQuestion({
          files: [
            { path: '.lmcc/history/x.py', archivePath: 'x.py' },
            { path: 'ok.py', archivePath: 'bad/../x.py' },
          ],
        })
      )
    );
    const messages = result.issues.map((issue) => issue.message);
    expect(messages).toContain('答案路径不能包含框架配置或历史目录。');
    expect(messages).toContain('不支持的相对文件路径：bad/../x.py');
  });

  test('reports unsafe localTest and evaluationCode paths', () => {
    const result = parseLmcc(
      document(
        baseQuestion({
          evaluationCode: '../evaluate.py',
          localTest: { script: 'a\\b.py' },
        })
      )
    );
    const fields = result.issues.map((issue) => issue.field);
    expect(fields).toContain('evaluationCode');
    expect(fields).toContain('localTest.script');
  });

  test('warns about duplicate declarations instead of failing', () => {
    const result = parseLmcc(
      document(
        baseQuestion({
          files: [
            { path: 'a.py', archivePath: 'a.py' },
            { path: 'a.py', archivePath: 'a.py' },
          ],
        })
      )
    );
    expect(result.issues.some((issue) => issue.code === 'LMCC_DUPLICATE')).toBe(
      true
    );
  });
});
