// =============================================================================
// MACHINE PROFILE
//
// A stress result is meaningless without the machine that produced it. This
// captures the hardware identity into the report so a number measured on a
// developer laptop can never be mistaken for a number measured on the till.
//
// It also carries the disk-durability probe, because on this workload the
// storage device is the single biggest determinant of checkout latency:
// `synchronous = FULL` fsyncs the WAL on every commit, so a till on eMMC or a
// spinning disk can be an order of magnitude slower per sale than an NVMe dev
// machine while every other spec looks similar.
// =============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// =============================================================================
// TYPES
// =============================================================================

export interface MachineProfile {
  readonly hostname: string;
  readonly platform: string;
  readonly release: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cpuCores: number;
  readonly cpuSpeedMhz: number;
  readonly totalMemoryGb: number;
  readonly freeMemoryGb: number;
  readonly nodeVersion: string;
  readonly capturedAt: string;
  /** Measured cost of one durable (fsync'd) write on the database's volume. */
  readonly fsyncMs: number;
  readonly databaseVolume: string;
}

// =============================================================================
// PROBE
// =============================================================================

/**
 * Measures the cost of an fsync on the volume the local database lives on.
 *
 * This is the floor under every checkout: SQLite in `synchronous = FULL` cannot
 * commit a sale faster than the disk can flush. Reporting it separately means a
 * slow stress result can be attributed to the hardware rather than the code.
 */
function probeFsyncMs(directory: string, iterations = 20): number {
  fs.mkdirSync(directory, { recursive: true });

  const probePath = path.join(directory, `.fsync-probe-${process.pid}`);
  const payload = Buffer.alloc(4096, 0x61);
  const timings: number[] = [];

  let handle: number | undefined;

  try {
    handle = fs.openSync(probePath, "w");

    for (let index = 0; index < iterations; index += 1) {
      const started = process.hrtime.bigint();

      fs.writeSync(handle, payload, 0, payload.length, 0);
      fs.fsyncSync(handle);

      timings.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
  } catch {
    return Number.NaN;
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        /* the probe file is disposable */
      }
    }
    try {
      fs.unlinkSync(probePath);
    } catch {
      /* already gone */
    }
  }

  if (timings.length === 0) return Number.NaN;

  // Median, not mean — one scheduling hiccup should not define the disk.
  const sorted = timings.sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

// =============================================================================
// CAPTURE
// =============================================================================

export function captureMachineProfile(databasePath: string): MachineProfile {
  const cpus = os.cpus();
  const first = cpus[0];
  const directory = path.dirname(path.resolve(databasePath));

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: first?.model.trim() ?? "unknown",
    cpuCores: cpus.length,
    cpuSpeedMhz: first?.speed ?? 0,
    totalMemoryGb: os.totalmem() / 1024 ** 3,
    freeMemoryGb: os.freemem() / 1024 ** 3,
    nodeVersion: process.version,
    capturedAt: new Date().toISOString(),
    fsyncMs: probeFsyncMs(directory),
    databaseVolume: path.parse(path.resolve(databasePath)).root,
  };
}

/**
 * Total on-disk footprint of the local database.
 *
 * The `.db` file alone under-reports: in WAL mode, committed data can sit in
 * `-wal` until a checkpoint folds it back in, so a till measured mid-day would
 * look smaller than it is. Capacity planning needs all three files.
 */
export function databaseSizeMb(databasePath: string): {
  readonly totalMb: number;
  readonly mainMb: number;
  readonly walMb: number;
} {
  const resolved = path.resolve(databasePath);

  const sizeOf = (file: string): number => {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  };

  const mainBytes = sizeOf(resolved);
  const walBytes = sizeOf(`${resolved}-wal`);
  const shmBytes = sizeOf(`${resolved}-shm`);

  const toMb = (bytes: number): number => bytes / 1024 / 1024;

  return {
    totalMb: toMb(mainBytes + walBytes + shmBytes),
    mainMb: toMb(mainBytes),
    walMb: toMb(walBytes),
  };
}
