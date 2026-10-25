const os = require("os");
const { ipcMain } = require("electron");
const { getGpus } = require("./gpu.js");

let previousCpuTimes = null;
let lastCpuUsage = null;

const readCpuTimes = () =>
  os.cpus().map(({ times }) => ({
    idle: times.idle,
    total: times.user + times.nice + times.sys + times.idle + times.irq,
  }));

// CPU usage is the idle-time delta between two consecutive samples.
const sampleCpuUsage = () => {
  const current = readCpuTimes();

  if (previousCpuTimes && previousCpuTimes.length === current.length) {
    let idleDelta = 0;
    let totalDelta = 0;

    current.forEach((core, index) => {
      idleDelta += core.idle - previousCpuTimes[index].idle;
      totalDelta += core.total - previousCpuTimes[index].total;
    });

    if (totalDelta > 0) {
      lastCpuUsage = Math.min(
        100,
        Math.max(0, (1 - idleDelta / totalDelta) * 100)
      );
    }
  }

  previousCpuTimes = current;
  return lastCpuUsage;
};

const sampleMemory = () => {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  return {
    used,
    total,
    percent: total > 0 ? (used / total) * 100 : null,
  };
};

const initSystemStats = () => {
  ipcMain.handle("system:getStats", async () => ({
    cpu: sampleCpuUsage(),
    memory: sampleMemory(),
    gpus: await getGpus(),
  }));
};

module.exports = { initSystemStats };
