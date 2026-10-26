// Public API of platform/ops: health of the installation (BAS-11) and
// operations alerts (PIL-04).
export { ALERT_EVERY_MS, runAlertRound } from "./alerts";
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
