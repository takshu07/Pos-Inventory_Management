// =============================================================================
// RESOURCE SAMPLER
//
// Background sampling of the things a stress run has to report but which cannot
// be measured by timing a function call: CPU, memory, and whether the process
// was still *responsive* while it did the work.
//
// ── Why event-loop delay is the responsiveness metric ────────────────────────
// "Application responsiveness" on a till is not throughput. A run can post an
// excellent sales/second figure while the UI freezes for a second at a time —
// the cashier experiences the freeze, not the average. Node's
// `monitorEventLoopDelay` records how late timers actually fired, which is the
// closest in-process proxy for "did the screen stop responding". A p99 of 50ms
// is invisible; a p99 of 2s is a till that looks hung mid-queue.
//
// ── Why RSS and not just heapUsed ────────────────────────────────────────────
// The existing stress harness reports `heapUsed`, which counts only V8's JS
// heap. better-sqlite3 is a native addon: its page cache, prepared statements
// and WAL buffers live OUTSIDE that heap and are invisible to it. On a 4GB till
// the number that decides whether the machine starts swapping is RSS, so RSS is
// what gets the verdict here.
// =============================================================================

import os from "node:os";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

// =============================================================================
// TYPES
// =============================================================================

export interface ResourceSummary {
  /** Wall-clock duration of the sampled window. */
  readonly durationMs: number;
  /** Mean CPU load attributable to this process, as a % of ONE core. */
  readonly cpuPercentOfOneCore: number;
  /** Same load expressed against the whole machine — what Task Manager shows. */
  readonly cpuPercentOfMachine: number;
  /** Peak resident set size — the real memory footprint, native included. */
  readonly rssPeakMb: number;
  readonly rssMeanMb: number;
  /** Peak V8 heap, kept for continuity with the older harness. */
  readonly heapPeakMb: number;
  /** Event-loop delay: the responsiveness figures, in milliseconds. */
  readonly loopDelayMeanMs: number;
  readonly loopDelayP50Ms: number;
  readonly loopDelayP99Ms: number;
  readonly loopDelayMaxMs: number;
  readonly samples: number;
  /**
   * False when the phase was too short for the loop-delay histogram to collect
   * anything. The responsiveness figures are then meaningless rather than good,
   * and a caller must not report them as a pass.
   */
  readonly loopDelayMeasured: boolean;
}

// =============================================================================
// SAMPLER
// =============================================================================

/**
 * Samples process resource use until `stop()` is called.
 *
 * Sampling is deliberately cheap (a timer plus two syscall-free reads) so that
 * observing the run does not distort the numbers it is observing.
 */
export class ResourceSampler {
  private readonly loopDelay: IntervalHistogram;
  private timer: NodeJS.Timeout | undefined;

  private startedAt = 0n;
  private startCpu: NodeJS.CpuUsage | undefined;

  private rssPeak = 0;
  private rssTotal = 0;
  private heapPeak = 0;
  private sampleCount = 0;

  constructor(private readonly intervalMs = 100) {
    // resolution:10ms — fine enough to see a stall, coarse enough to be free.
    this.loopDelay = monitorEventLoopDelay({ resolution: 10 });
  }

  start(): void {
    this.startedAt = process.hrtime.bigint();
    this.startCpu = process.cpuUsage();
    this.loopDelay.reset();
    this.loopDelay.enable();

    // Take one sample immediately. A phase shorter than the sampling interval
    // would otherwise finish with zero samples and report 0 MB — a memory
    // threshold that silently passes because nothing was ever measured.
    this.sample();

    this.timer = setInterval(() => this.sample(), this.intervalMs);

    // Sampling must never be the reason the process stays alive.
    this.timer.unref();
  }

  private sample(): void {
    const memory = process.memoryUsage();

    this.rssPeak = Math.max(this.rssPeak, memory.rss);
    this.rssTotal += memory.rss;
    this.heapPeak = Math.max(this.heapPeak, memory.heapUsed);
    this.sampleCount += 1;
  }

  stop(): ResourceSummary {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.loopDelay.disable();

    const durationMs = Number(process.hrtime.bigint() - this.startedAt) / 1e6;
    const cpu = process.cpuUsage(this.startCpu);

    // cpuUsage is microseconds of CPU time; duration is milliseconds of wall
    // clock. Both normalised to the same unit before the ratio.
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const cpuPercentOfOneCore = durationMs > 0 ? (cpuMs / durationMs) * 100 : 0;

    const cores = Math.max(1, os.cpus().length);

    const toMb = (bytes: number): number => bytes / 1024 / 1024;

    return {
      durationMs,
      cpuPercentOfOneCore,
      cpuPercentOfMachine: cpuPercentOfOneCore / cores,
      rssPeakMb: toMb(this.rssPeak),
      rssMeanMb: this.sampleCount > 0 ? toMb(this.rssTotal / this.sampleCount) : 0,
      heapPeakMb: toMb(this.heapPeak),
      loopDelayMeanMs: this.loopDelay.mean / 1e6,
      loopDelayP50Ms: this.loopDelay.percentile(50) / 1e6,
      loopDelayP99Ms: this.loopDelay.percentile(99) / 1e6,
      loopDelayMaxMs: this.loopDelay.max / 1e6,
      samples: this.sampleCount,
      // `exceeds` counts recorded intervals; 0 means the histogram never ticked.
      loopDelayMeasured: this.loopDelay.count > 0,
    };
  }
}

// =============================================================================
// LATENCY DISTRIBUTION
// =============================================================================

/**
 * Collects individual operation timings so the report can quote percentiles.
 *
 * An average write latency is a poor summary of a fsync-bound workload: most
 * commits are fast and a few are very slow, so the mean sits in a range where
 * almost no actual sale landed. p95/p99 are what a cashier notices.
 */
export class LatencyRecorder {
  private readonly samplesMs: number[] = [];

  record(ms: number): void {
    this.samplesMs.push(ms);
  }

  async time<T>(work: () => Promise<T>): Promise<T> {
    const started = process.hrtime.bigint();
    try {
      return await work();
    } finally {
      this.record(Number(process.hrtime.bigint() - started) / 1e6);
    }
  }

  get count(): number {
    return this.samplesMs.length;
  }

  /**
   * Total time spent inside the timed operations.
   *
   * Lets a caller report throughput against real work when the workload loop
   * also contains deliberate think-time that should not count against it.
   */
  get totalMs(): number {
    return this.samplesMs.reduce((sum, value) => sum + value, 0);
  }

  summary(): LatencySummary {
    if (this.samplesMs.length === 0) {
      return { count: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, minMs: 0 };
    }

    const sorted = [...this.samplesMs].sort((a, b) => a - b);
    const at = (fraction: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;

    return {
      count: sorted.length,
      meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
      p50Ms: at(0.5),
      p95Ms: at(0.95),
      p99Ms: at(0.99),
      maxMs: sorted[sorted.length - 1] ?? 0,
      minMs: sorted[0] ?? 0,
    };
  }
}

export interface LatencySummary {
  readonly count: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly minMs: number;
}
