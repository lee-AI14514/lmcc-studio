import {
  deriveEvaluationOutcome,
  evaluationDisabledReason,
  formatEvaluationDuration,
  parseEvaluationResult,
  parseEvaluationRuntime,
  selectEvaluationScript,
} from './evaluationModel';

describe('selectEvaluationScript', () => {
  test('prefers localTest.script', () => {
    const target = selectEvaluationScript({
      localTest: { script: 'check.py' },
      evaluationCode: 'remote.py',
    });
    expect(target).toEqual({
      script: 'check.py',
      source: 'localTest',
      label: 'localTest.script',
    });
  });

  test('does not execute evaluationCode, which is read-only', () => {
    expect(
      selectEvaluationScript({ localTest: null, evaluationCode: 'eval.py' })
    ).toBeNull();
  });

  test('returns null when no evaluator is declared', () => {
    expect(selectEvaluationScript({})).toBeNull();
    expect(selectEvaluationScript(null)).toBeNull();
  });

});

describe('parseEvaluationRuntime', () => {
  test('reads capabilities.localEvaluation', () => {
    expect(
      parseEvaluationRuntime(
        '{"runtimeId":"lmcc-python-3.12","capabilities":{"localEvaluation":false}}'
      )
    ).toMatchObject({
      state: 'ready',
      runtimeId: 'lmcc-python-3.12',
      localEvaluation: false,
    });
  });

  test('reports a missing runtime file', () => {
    expect(parseEvaluationRuntime(null)).toMatchObject({
      state: 'missing',
      localEvaluation: null,
    });
  });

  test('reports invalid JSON', () => {
    expect(parseEvaluationRuntime('{nope')).toMatchObject({
      state: 'invalid',
    });
  });

  test('treats a non-object runtime as invalid', () => {
    expect(parseEvaluationRuntime('[]')).toMatchObject({
      state: 'invalid',
    });
  });
});

describe('evaluationDisabledReason', () => {
  const target = { script: 'check.py', source: 'localTest' };
  const runtime = {
    state: 'ready',
    runtimeId: 'lmcc-python-3.12',
    localEvaluation: true,
  };

  test('allows a normal Python evaluator', () => {
    expect(
      evaluationDisabledReason({ target, runtime, bridgeAvailable: true })
    ).toBeNull();
  });

  test('requires the Electron bridge', () => {
    expect(
      evaluationDisabledReason({ target, runtime, bridgeAvailable: false })
    ).toContain('Electron');
  });

  test('requires a declared evaluator', () => {
    expect(
      evaluationDisabledReason({ target: null, runtime, bridgeAvailable: true })
    ).toContain('localTest.script');
  });


  test('honours localEvaluation: false', () => {
    expect(
      evaluationDisabledReason({
        target,
        runtime: {
          state: 'ready',
          runtimeId: 'lmcc-python-3.12',
          localEvaluation: false,
        },
        bridgeAvailable: true,
      })
    ).toContain('localEvaluation');
  });

  test('rejects a missing runtime', () => {
    expect(
      evaluationDisabledReason({
        target,
        runtime: { state: 'missing', runtimeId: null, localEvaluation: null },
        bridgeAvailable: true,
      })
    ).toContain('runtime.json');
  });

  test('rejects a runtime without runtimeId', () => {
    expect(
      evaluationDisabledReason({
        target,
        runtime: { state: 'ready', runtimeId: null, localEvaluation: null },
        bridgeAvailable: true,
      })
    ).toContain('runtimeId');
  });

  test('rejects an unreadable runtime', () => {
    expect(
      evaluationDisabledReason({
        target,
        runtime: {
          state: 'unavailable',
          runtimeId: null,
          localEvaluation: null,
          message: '读取失败。',
        },
        bridgeAvailable: true,
      })
    ).toBe('读取失败。');
  });
});

describe('parseEvaluationResult', () => {
  test('parses the whole stdout JSON', () => {
    expect(parseEvaluationResult('{"ok":true,"score":90}')).toEqual({
      ok: true,
      score: 90,
    });
  });

  test('parses a final JSON line after logs', () => {
    expect(
      parseEvaluationResult('running tests...\n{"ok":false}\n')
    ).toEqual({ ok: false, score: null });
  });

  test('ignores output without a result envelope', () => {
    expect(parseEvaluationResult('all good\n')).toBeNull();
  });

  test('parses a Chinese score summary from a real paper', () => {
    expect(parseEvaluationResult('正确题数：10/10\n得分：50/50')).toEqual({
      ok: true,
      score: 50,
      maxScore: 50,
    });
    expect(parseEvaluationResult('得分：45/50')).toMatchObject({
      ok: false,
      score: 45,
    });
  });
});

describe('deriveEvaluationOutcome', () => {
  test('marks JSON ok true as passed', () => {
    expect(
      deriveEvaluationOutcome({ exitCode: 0, result: { ok: true } })
    ).toMatchObject({ status: 'passed', tone: 'ok' });
  });

  test('marks JSON ok false as failed even with exit code 0', () => {
    expect(
      deriveEvaluationOutcome({ exitCode: 0, result: { ok: false } })
    ).toMatchObject({ status: 'failed', tone: 'error' });
  });

  test('marks a non-zero exit as failed', () => {
    expect(deriveEvaluationOutcome({ exitCode: 2 })).toMatchObject({
      status: 'failed',
    });
  });

  test('marks a completed script without a result as completed', () => {
    expect(deriveEvaluationOutcome({ exitCode: 0 })).toMatchObject({
      status: 'completed',
    });
  });

  test('reports timeout and user stop distinctly', () => {
    expect(deriveEvaluationOutcome({ stopped: 'timeout' })).toMatchObject({
      status: 'failed',
    });
    expect(deriveEvaluationOutcome({ stopped: 'stopped' })).toMatchObject({
      status: 'stopped',
    });
  });

  test('reports an output limit as failed', () => {
    expect(deriveEvaluationOutcome({ truncated: true })).toMatchObject({
      status: 'failed',
    });
  });
});

describe('formatEvaluationDuration', () => {
  test('formats milliseconds and seconds', () => {
    expect(formatEvaluationDuration(320)).toBe('320 ms');
    expect(formatEvaluationDuration(1240)).toBe('1.2 s');
    expect(formatEvaluationDuration(null)).toBe('—');
  });
});
