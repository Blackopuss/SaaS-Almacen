import "server-only";

import { isAppError, newId } from "@/lib";
import { db, forOrganization, type TenantDb } from "@/server";

/**
 * Durable job queue in MySQL (IMP-01, ADR 0013). A job is a row: it
 * survives restarts, belongs to one company and is run by a worker
 * process, apart from the requests of the web application.
 *
 * - **At least once.** A job whose worker died is taken again, so a
 *   handler may run twice for the same job: handlers must be idempotent
 *   (the job id is a good key for it).
 * - **Bounded retries.** A failed attempt waits and tries again, up to
 *   `maxAttempts`; then the job is `FAILED` and stays there.
 * - **Company context.** The handler receives the company of the row —
 *   never one read from the payload — and works with `forOrganization`.
 */

export type JobContext<Payload = unknown> = {
  jobId: string;
  /** Company the job belongs to: the only one the handler may touch. */
  organizationId: string;
  /** Person who asked for it, when a person did. */
  createdByUserId: string | null;
  payload: Payload;
  /** 1 on the first try. */
  attempt: number;
  maxAttempts: number;
};

export type JobHandler = {
  /** Does the work; what it returns is kept as the result of the job. */
  handle: (context: JobContext) => Promise<unknown>;
  /** Wait before the next attempt; default grows from 5 s to 15 min. */
  retryDelayMs?: (attempt: number) => number;
  /**
   * Called once the job has failed for good — it used up its attempts or
   * its worker disappeared — to give back what the job was holding (a
   * reservation). Never called while the job can still run. Like
   * `handle`, it may run more than once for the same job.
   */
  onFailed?: (context: JobContext) => Promise<void>;
};

/** Handlers by job type: "inventory.import_products" → handler. */
export type JobHandlers = Record<string, JobHandler>;

const TYPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_MAX_ATTEMPTS = 5;
/** A job running longer than this lost its worker. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

const defaultRetryDelay = (attempt: number) =>
  Math.min(5_000 * 2 ** (attempt - 1), 15 * 60 * 1000);

/** Short text of a failure, for people: no stack, no line breaks. */
function describeError(error: unknown): string {
  const text =
    isAppError(error) || error instanceof Error
      ? error.message
      : "Error desconocido";
  return text.replace(/\s+/g, " ").trim().slice(0, 500) || "Error desconocido";
}

export type EnqueueInput = {
  type: string;
  /** Data the handler needs: ids and options, never secrets. */
  payload?: unknown;
  createdByUserId?: string | null;
  /** Not before this moment; default now. */
  runAt?: Date;
  maxAttempts?: number;
};

/**
 * Adds a job for a company. `client` is the company client or — better —
 * the transaction that makes the change the job follows, so the job
 * exists only if that change did.
 */
export async function enqueueJob(
  client: Pick<TenantDb, "job">,
  organizationId: string,
  input: EnqueueInput,
): Promise<{ jobId: string }> {
  if (!TYPE.test(input.type) || input.type.length > 64) {
    throw new Error(`Invalid job type: ${input.type}`);
  }
  const payload = JSON.stringify(input.payload ?? {});
  if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload of ${input.type} is too large for a job`);
  }
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error("maxAttempts must be between 1 and 20");
  }
  const jobId = newId();
  await client.job.create({
    data: {
      id: jobId,
      organizationId,
      type: input.type,
      payload: JSON.parse(payload),
      maxAttempts,
      runAt: input.runAt ?? new Date(),
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return { jobId };
}

export type JobInfo = {
  id: string;
  type: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  result: unknown;
  createdAt: Date;
  finishedAt: Date | null;
};

/** State of a job of the company; null when it is not one of its jobs. */
export async function getJob(
  organizationId: string,
  jobId: string,
): Promise<JobInfo | null> {
  return forOrganization(organizationId).job.findFirst({
    where: { id: String(jobId).slice(0, 36) },
    select: {
      id: true,
      type: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      lastError: true,
      result: true,
      createdAt: true,
      finishedAt: true,
    },
  });
}

type Claimed = {
  id: string;
  organizationId: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  createdByUserId: string | null;
};

/**
 * Takes the next job that is due — or one whose worker disappeared — and
 * marks it as running for this worker. Two workers never take the same
 * row: each candidate is locked with `FOR UPDATE SKIP LOCKED` and read
 * again under the lock. The queue is infrastructure: it looks across
 * companies, and hands each job over with its own.
 */
async function claim(
  workerId: string,
  now: Date,
  staleBefore: Date,
): Promise<Claimed | null> {
  const due = {
    OR: [
      { status: "PENDING" as const, runAt: { lte: now } },
      { status: "RUNNING" as const, lockedAt: { lt: staleBefore } },
    ],
  };
  /** Jobs another worker is taking right now, or just closed here. */
  const skipped: string[] = [];
  for (let round = 0; round < 20; round++) {
    const candidates = await db.job.findMany({
      where: { ...due, id: { notIn: skipped } },
      orderBy: [{ runAt: "asc" }, { id: "asc" }],
      take: 10,
      select: { id: true },
    });
    if (candidates.length === 0) return null;
    for (const { id } of candidates) {
      const claimed = await db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM job WHERE id = ${id} FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) return null;
        // Under the lock: it may have been taken and finished meanwhile.
        const job = await tx.job.findFirst({ where: { ...due, id } });
        if (!job) return null;
        if (job.attempts >= job.maxAttempts) {
          // Abandoned with no attempts left: it ends here.
          await tx.job.update({
            where: { id },
            data: {
              status: "FAILED",
              finishedAt: now,
              lockedAt: null,
              lockedBy: null,
              lastError:
                "El trabajo se interrumpió y agotó sus intentos. No se volverá a intentar.",
            },
          });
          return null;
        }
        await tx.job.update({
          where: { id },
          data: {
            status: "RUNNING",
            attempts: job.attempts + 1,
            lockedAt: now,
            lockedBy: workerId,
          },
        });
        return {
          id,
          organizationId: job.organizationId,
          type: job.type,
          payload: job.payload,
          attempts: job.attempts + 1,
          maxAttempts: job.maxAttempts,
          createdByUserId: job.createdByUserId,
        } satisfies Claimed;
      });
      if (claimed) return claimed;
      skipped.push(id);
    }
  }
  return null;
}

export type RunOutcome =
  | { kind: "idle" }
  | { kind: "done"; jobId: string; organizationId: string }
  | {
      kind: "retry";
      jobId: string;
      organizationId: string;
      attempt: number;
      runAt: Date;
      error: string;
    }
  | { kind: "failed"; jobId: string; organizationId: string; error: string };

export type RunOptions = {
  /** Name of this worker, kept on the job while it runs. */
  workerId?: string;
  /** Clock, for tests. */
  now?: () => Date;
  staleAfterMs?: number;
};

/**
 * Runs one job, if there is one due: claims it, calls its handler with
 * the company of the job and records how it ended.
 */
export async function runNextJob(
  handlers: JobHandlers,
  options: RunOptions = {},
): Promise<RunOutcome> {
  const workerId = (options.workerId ?? `worker-${process.pid}`).slice(0, 64);
  const clock = options.now ?? (() => new Date());
  const started = clock();
  const job = await claim(
    workerId,
    started,
    new Date(started.getTime() - (options.staleAfterMs ?? STALE_AFTER_MS)),
  );
  if (!job) return { kind: "idle" };

  const { id: jobId, organizationId } = job;
  // Only the worker that holds the job may close it: if it was taken
  // away as abandoned, this result is no longer the one that counts.
  const mine = { id: jobId, status: "RUNNING" as const, lockedBy: workerId };
  const handler = handlers[job.type];

  let failure: unknown = null;
  let permanent = false;
  if (!handler) {
    failure = new Error(`No hay quien procese trabajos «${job.type}».`);
    permanent = true;
  } else {
    try {
      const result = await handler.handle({
        jobId,
        organizationId,
        createdByUserId: job.createdByUserId,
        payload: job.payload,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
      });
      await db.job.updateMany({
        where: mine,
        data: {
          status: "DONE",
          finishedAt: clock(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          // Only what JSON can hold is kept.
          result:
            result === undefined
              ? undefined
              : JSON.parse(JSON.stringify(result)),
        },
      });
      return { kind: "done", jobId, organizationId };
    } catch (error) {
      failure = error;
    }
  }

  const error = describeError(failure);
  console.error(
    `[jobs] ${job.type} ${jobId} (empresa ${organizationId}) falló en el intento ${job.attempts} de ${job.maxAttempts}:`,
    failure,
  );
  const ended = clock();
  if (permanent || job.attempts >= job.maxAttempts) {
    await db.job.updateMany({
      where: mine,
      data: {
        status: "FAILED",
        finishedAt: ended,
        lockedAt: null,
        lockedBy: null,
        lastError: error,
      },
    });
    return { kind: "failed", jobId, organizationId, error };
  }
  const delay = (handler?.retryDelayMs ?? defaultRetryDelay)(job.attempts);
  const runAt = new Date(ended.getTime() + Math.max(0, delay));
  await db.job.updateMany({
    where: mine,
    data: {
      status: "PENDING",
      runAt,
      lockedAt: null,
      lockedBy: null,
      lastError: error,
    },
  });
  return {
    kind: "retry",
    jobId,
    organizationId,
    attempt: job.attempts,
    runAt,
    error,
  };
}

export type SettleOutcome = {
  /** Failed jobs whose held things were given back now. */
  settled: number;
  /** Failed jobs that could not be settled yet; tried again next time. */
  pending: number;
};

/**
 * Gives back what jobs that failed for good were holding (IMP-08B): for
 * each `FAILED` job not yet settled, calls `onFailed` of its handler and
 * marks it. It covers every way a job ends as failed — its last attempt,
 * an unknown type, a worker that disappeared — because it starts from the
 * rows, not from the worker that was running them. A job that is waiting
 * or running is never touched.
 *
 * If `onFailed` fails the job stays unsettled and is tried again on the
 * next call; two workers may settle the same job, so `onFailed` must be
 * safe to repeat. Jobs of a type this worker has no handler for are left
 * as they are, for a worker that knows what they were holding.
 */
export async function settleFailedJobs(
  handlers: JobHandlers,
  options: { limit?: number } = {},
): Promise<SettleOutcome> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const jobs = await db.job.findMany({
    where: {
      status: "FAILED",
      failureHandledAt: null,
      type: { in: Object.keys(handlers) },
    },
    orderBy: [{ finishedAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  let settled = 0;
  let pending = 0;
  for (const job of jobs) {
    try {
      await handlers[job.type]?.onFailed?.({
        jobId: job.id,
        organizationId: job.organizationId,
        createdByUserId: job.createdByUserId,
        payload: job.payload,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
      });
    } catch (error) {
      pending++;
      console.error(
        `[jobs] no se pudo liberar lo que retenía ${job.type} ${job.id} (empresa ${job.organizationId}); se intentará de nuevo:`,
        error,
      );
      continue;
    }
    await db.job.updateMany({
      where: { id: job.id, status: "FAILED", failureHandledAt: null },
      data: { failureHandledAt: new Date() },
    });
    settled++;
  }
  return { settled, pending };
}

/**
 * Worker loop: runs jobs one after another and rests while there are
 * none. Stops, after the job in hand, when `signal` is aborted. Between
 * jobs it settles the ones that failed for good, at most every
 * `settleEveryMs`, and right after one fails.
 */
export async function runWorker(
  handlers: JobHandlers,
  options: RunOptions & {
    signal?: AbortSignal;
    idleMs?: number;
    settleEveryMs?: number;
    onOutcome?: (outcome: RunOutcome) => void;
  } = {},
): Promise<void> {
  const idleMs = options.idleMs ?? 1_000;
  const settleEveryMs = options.settleEveryMs ?? 30_000;
  let settledAt = 0;
  while (!options.signal?.aborted) {
    let outcome: RunOutcome;
    try {
      outcome = await runNextJob(handlers, options);
    } catch (error) {
      // The database blinked: wait and go on, the queue is still there.
      console.error("[jobs] no se pudo tomar el siguiente trabajo:", error);
      outcome = { kind: "idle" };
    }
    if (outcome.kind === "failed" || Date.now() - settledAt >= settleEveryMs) {
      settledAt = Date.now();
      try {
        await settleFailedJobs(handlers);
      } catch (error) {
        console.error("[jobs] no se pudieron revisar los fallidos:", error);
      }
    }
    options.onOutcome?.(outcome);
    if (outcome.kind === "idle") {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, idleMs);
        function done() {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", done);
          resolve();
        }
        options.signal?.addEventListener("abort", done, { once: true });
      });
    }
  }
}
