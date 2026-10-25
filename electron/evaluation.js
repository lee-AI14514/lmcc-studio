/**
 * IPC adapter for the local evaluation runner.
 *
 * The renderer asks for a run; every stdout/stderr/exit event is sent back on
 * the dedicated `lmcc:evaluation-event` channel. Output is streamed, so the
 * reader's output panel can show progress while the Python script is still
 * running.
 */
const { app, ipcMain } = require('electron');
const {
  startEvaluation,
  stopEvaluation,
  stopAllEvaluations,
} = require('./evaluationRunner');

const EVENT_CHANNEL = 'lmcc:evaluation-event';
let registered = false;

/** webContents id -> Set<runId>, used to stop work for a closed window. */
const senderRuns = new Map();

function trackRun(sender, runId) {
  let ids = senderRuns.get(sender.id);
  if (!ids) {
    ids = new Set();
    senderRuns.set(sender.id, ids);
    sender.once('destroyed', () => {
      for (const activeRunId of ids) stopEvaluation(activeRunId);
      senderRuns.delete(sender.id);
    });
  }
  ids.add(runId);
}

function untrackRun(sender, runId) {
  const ids = senderRuns.get(sender.id);
  if (!ids) return;
  ids.delete(runId);
  if (ids.size === 0) senderRuns.delete(sender.id);
}

async function handleStart(sender, payload) {
  if (!sender || sender.isDestroyed()) {
    return { ok: false, code: 'closed', message: '窗口已经关闭。' };
  }

  const runId = payload?.runId;
  // Track before starting: a very short script may emit `exit` before the
  // start invoke resolves.
  trackRun(sender, runId);
  let tracked = true;
  let result;
  try {
    result = await startEvaluation(payload, (event) => {
      if (event.type === 'exit' && tracked) {
        tracked = false;
        untrackRun(sender, runId);
      }
      if (!sender.isDestroyed()) {
        sender.send(EVENT_CHANNEL, event);
      }
    });
  } catch {
    result = {
      ok: false,
      code: 'internal',
      message: '启动评测时发生内部错误。',
    };
  }

  if (!result.ok && tracked) {
    tracked = false;
    untrackRun(sender, runId);
  } else if (result.ok && sender.isDestroyed()) {
    // The window disappeared while Python was starting.
    stopEvaluation(runId);
    untrackRun(sender, runId);
  }
  return result;
}

function registerEvaluationIpc() {
  if (registered) return;
  registered = true;

  ipcMain.handle('lmcc:evaluation-start', (event, payload) =>
    handleStart(event.sender, payload)
  );

  ipcMain.handle('lmcc:evaluation-stop', (event, payload) => {
    const runId = payload?.runId;
    const result = stopEvaluation(runId);
    if (result.ok && event.sender) untrackRun(event.sender, runId);
    return result;
  });

  app.once('before-quit', () => {
    stopAllEvaluations();
    senderRuns.clear();
  });
}

module.exports = {
  registerEvaluationIpc,
  EVENT_CHANNEL,
};
