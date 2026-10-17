// Public API of platform/ops: health of the installation (BAS-11, PIL-04).
export {
  BACKUP_STALE_AFTER_MS,
  ERROR_ALERT_THRESHOLD,
  HEARTBEAT_EVERY_MS,
  QUEUE_STUCK_AFTER_MS,
  WORKER_DOWN_AFTER_MS,
  checkHealth,
  heartbeatFile,
  writeWorkerHeartbeat,
} from "./health";
export type { CheckState, Health } from "./health";
