const fs = require("fs");
const { execFile, execFileSync } = require("child_process");

const MIB = 1024 * 1024;
// Windows non-NVIDIA cards need a PowerShell/CIM query per refresh, so keep
// that slower than the cheap nvidia-smi / sysfs sources.
const CACHE_MS = process.platform === "win32" ? 4000 : 2000;
const FAIL_BACKOFF_MS = 30000;

const VENDOR_NAMES = {
  "0x10de": "NVIDIA",
  "0x1002": "AMD",
  "0x8086": "Intel",
};

const NVIDIA_ARGS = [
  "--query-gpu=index,name,pci.bus_id,utilization.gpu,memory.used,memory.total",
  "--format=csv,noheader,nounits",
];
const NVIDIA_WINDOWS_PATH =
  "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe";

// WMI performance classes are language independent (unlike Get-Counter names)
// and expose GPU engine utilisation and dedicated memory for every vendor.
const WINDOWS_GPU_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$engines = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Select-Object Name, UtilizationPercentage)",
  "$memory = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Select-Object Name, DedicatedUsage)",
  "[PSCustomObject]@{ engines = $engines; memory = $memory } | ConvertTo-Json -Depth 4 -Compress",
].join("\n");

let cachedGpus = null;
let cachedAt = 0;
let inFlight = null;
let nvidiaBlockedUntil = 0;
let windowsBlockedUntil = 0;
const lspciNameCache = new Map();

const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
};

const readNumber = (file) => {
  const raw = readText(file);
  if (raw == null) return null;

  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
};

const toNumber = (value) => {
  if (value == null) return null;

  const parsed = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const clampPercent = (value) =>
  value == null ? null : Math.min(100, Math.max(0, value));

const withMemoryPercent = (gpu) => ({
  ...gpu,
  memPercent:
    gpu.memUsed != null && gpu.memTotal > 0
      ? clampPercent((gpu.memUsed / gpu.memTotal) * 100)
      : null,
});

const execFileAsync = (file, args, options = {}) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: 3000, windowsHide: true, maxBuffer: 1024 * 1024, ...options },
      (error, stdout) => resolve(error ? null : String(stdout))
    );
  });

// "00000000:01:00.0" (nvidia-smi) and "0000:01:00.0" (sysfs) -> "01:00.0"
const normalizePciKey = (value) => {
  if (!value) return null;

  const parts = String(value).trim().split(":");
  return parts.length >= 2 ? parts.slice(-2).join(":") : String(value).trim();
};

const parseNvidia = (stdout) =>
  String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",").map((part) => part.trim());
      if (parts.length < 6) return null;

      const index = parts[0];
      const name = parts.slice(1, parts.length - 4).join(", ");
      const pci = parts[parts.length - 4];
      const util = toNumber(parts[parts.length - 3]);
      const memUsed = toNumber(parts[parts.length - 2]);
      const memTotal = toNumber(parts[parts.length - 1]);

      return withMemoryPercent({
        id: `nvidia-${index}`,
        name: name || "NVIDIA GPU",
        vendor: "NVIDIA",
        pciKey: normalizePciKey(pci),
        util: clampPercent(util),
        memUsed: memUsed == null ? null : memUsed * MIB,
        memTotal: memTotal == null ? null : memTotal * MIB,
      });
    })
    .filter(Boolean);

const collectNvidia = async () => {
  if (Date.now() < nvidiaBlockedUntil) return [];

  const binaries =
    process.platform === "win32"
      ? ["nvidia-smi", NVIDIA_WINDOWS_PATH]
      : ["nvidia-smi"];

  for (const binary of binaries) {
    const stdout = await execFileAsync(binary, NVIDIA_ARGS);
    if (stdout) {
      const gpus = parseNvidia(stdout);
      if (gpus.length > 0) return gpus;
    }
  }

  nvidiaBlockedUntil = Date.now() + FAIL_BACKOFF_MS;
  return [];
};

// /proc/driver/nvidia/gpus/*/information has the marketing name even when
// nvidia-smi is not usable (e.g. restricted environments).
const readNvidiaModelNames = (procRoot = "/proc/driver/nvidia/gpus") => {
  const names = new Map();
  let dirs = [];

  try {
    dirs = fs.readdirSync(procRoot);
  } catch {
    return names;
  }

  dirs.forEach((dir) => {
    const info = readText(`${procRoot}/${dir}/information`);
    if (!info) return;

    const model = /^Model:\s*(.+)$/m.exec(info);
    const bus = /^Bus Location:\s*(.+)$/m.exec(info);
    if (model && bus) names.set(normalizePciKey(bus[1]), model[1].trim());
  });

  return names;
};

const readSlot = (device) => {
  const uevent = readText(`${device}/uevent`);
  if (!uevent) return null;

  const line = uevent
    .split("\n")
    .find((entry) => entry.startsWith("PCI_SLOT_NAME="));
  return line ? line.slice("PCI_SLOT_NAME=".length).trim() : null;
};

const lookupLspciName = (slot) => {
  if (!slot) return null;
  if (lspciNameCache.has(slot)) return lspciNameCache.get(slot);

  let name = null;

  try {
    const output = execFileSync("lspci", ["-mm", "-s", slot], {
      timeout: 1000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = /^\S+\s+"[^"]*"\s+"([^"]*)"\s+"([^"]*)"/.exec(output.trim());

    if (match) {
      const vendor = match[1];
      const device = match[2];
      name = device.startsWith("Device ") ? `${vendor} ${device}` : device;
    }
  } catch {
    name = null;
  }

  lspciNameCache.set(slot, name);
  return name;
};

const collectLinux = (nvidiaGpus, options = {}) => {
  const drmRoot = options.drmRoot || "/sys/class/drm";
  const procRoot = options.procRoot || "/proc/driver/nvidia/gpus";
  let entries = [];

  try {
    entries = fs.readdirSync(drmRoot);
  } catch {
    return [];
  }

  const coveredPciKeys = new Set(
    nvidiaGpus.map((gpu) => gpu.pciKey).filter(Boolean)
  );
  const nvidiaNames = readNvidiaModelNames(procRoot);
  const gpus = [];

  entries
    .filter((entry) => /^card\d+$/.test(entry))
    .sort()
    .forEach((card) => {
      const device = `${drmRoot}/${card}/device`;
      const vendorId = readText(`${device}/vendor`);
      const slot = readSlot(device);
      const pciKey = normalizePciKey(slot);

      if (pciKey && coveredPciKeys.has(pciKey)) return;
      if (vendorId === "0x10de" && nvidiaGpus.length > 0) return;

      const vendor = VENDOR_NAMES[vendorId] || "GPU";
      const name =
        (pciKey && nvidiaNames.get(pciKey)) ||
        lookupLspciName(slot) ||
        `${vendor} GPU`;

      let util = null;
      let memUsed = null;
      let memTotal = null;

      if (vendorId === "0x1002") {
        // amdgpu exposes utilisation and dedicated VRAM through sysfs.
        util = readNumber(`${device}/gpu_busy_percent`);
        memUsed = readNumber(`${device}/mem_info_vram_used`);
        memTotal = readNumber(`${device}/mem_info_vram_total`);
      } else if (vendorId === "0x8086") {
        // some Intel drivers expose this, most currently do not
        util = readNumber(`${device}/gpu_busy_percent`);
      }

      gpus.push(
        withMemoryPercent({
          id: `linux-${pciKey || card}`,
          name,
          vendor,
          pciKey,
          util: clampPercent(util),
          memUsed,
          memTotal,
        })
      );
    });

  return gpus;
};

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
};

const parseWindowsCounterName = (name) => {
  if (!name) return null;

  const luid = /luid_0x([0-9a-fA-F]+)_0x([0-9a-fA-F]+)_phys_(\d+)/.exec(name);
  if (!luid) return null;

  const engine = /engtype_([A-Za-z0-9]+)/.exec(name);

  return {
    luid: `${luid[1]}-${luid[2]}-${luid[3]}`,
    engine: engine ? engine[1].toLowerCase() : "other",
  };
};

const parseWindowsPayload = (stdout) => {
  let payload;

  try {
    payload = JSON.parse(String(stdout).trim());
  } catch {
    return [];
  }

  const adapters = new Map();

  const ensureAdapter = (luid) => {
    if (!adapters.has(luid)) {
      adapters.set(luid, { luid, engines: new Map(), memUsed: null });
    }
    return adapters.get(luid);
  };

  asArray(payload.engines).forEach((entry) => {
    const parsed = parseWindowsCounterName(entry.Name);
    if (!parsed) return;

    const adapter = ensureAdapter(parsed.luid);
    const util = toNumber(entry.UtilizationPercentage) || 0;
    adapter.engines.set(
      parsed.engine,
      (adapter.engines.get(parsed.engine) || 0) + util
    );
  });

  asArray(payload.memory).forEach((entry) => {
    const parsed = parseWindowsCounterName(entry.Name);
    if (!parsed) return;

    const adapter = ensureAdapter(parsed.luid);
    const used = toNumber(entry.DedicatedUsage);

    if (used != null) adapter.memUsed = Math.max(adapter.memUsed || 0, used);
  });

  // The busiest engine type is what Task Manager reports as total GPU usage.
  return Array.from(adapters.values()).map((adapter, index) =>
    withMemoryPercent({
      id: `win-luid-${adapter.luid}`,
      name: `GPU ${index + 1}`,
      vendor: null,
      pciKey: null,
      util: adapter.engines.size
        ? clampPercent(Math.max(...adapter.engines.values()))
        : null,
      memUsed: adapter.memUsed,
      memTotal: null,
    })
  );
};

const collectWindows = async () => {
  if (Date.now() < windowsBlockedUntil) return [];

  const stdout = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      WINDOWS_GPU_SCRIPT,
    ],
    { timeout: 5000 }
  );

  const gpus = stdout ? parseWindowsPayload(stdout) : [];

  if (gpus.length === 0) {
    windowsBlockedUntil = Date.now() + FAIL_BACKOFF_MS;
  }

  return gpus;
};

const collect = async () => {
  const nvidia = await collectNvidia();

  if (process.platform === "win32") {
    // nvidia-smi covers NVIDIA; fall back to WMI counters for other vendors.
    return nvidia.length > 0 ? nvidia : collectWindows();
  }

  if (process.platform === "linux") {
    return [...nvidia, ...collectLinux(nvidia)];
  }

  return nvidia;
};

const getGpus = () => {
  const now = Date.now();

  if (cachedGpus && now - cachedAt < CACHE_MS) {
    return Promise.resolve(cachedGpus);
  }

  if (inFlight) return inFlight;

  inFlight = collect()
    .then((gpus) => {
      cachedGpus = gpus;
      cachedAt = Date.now();
      return gpus;
    })
    .catch(() => cachedGpus || [])
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

module.exports = {
  getGpus,
  __test: {
    parseNvidia,
    parseWindowsPayload,
    parseWindowsCounterName,
    normalizePciKey,
    collectLinux,
  },
};
