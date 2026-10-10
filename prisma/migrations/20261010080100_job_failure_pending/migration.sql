-- Corrects 20261010080000: jobs that had already failed were marked as
-- settled without giving back what they held. An import that failed before
-- this step may still hold places of the plan, so every failed job goes
-- back to «not settled» and the worker settles it on its next round (jobs
-- that held nothing are simply marked then).
UPDATE `job` SET `failureHandledAt` = NULL WHERE `status` = 'FAILED';
