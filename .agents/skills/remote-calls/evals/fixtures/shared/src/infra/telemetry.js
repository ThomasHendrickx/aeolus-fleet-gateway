// Existing application telemetry boundary. Both exported arrays are event ledgers.
export const logs = [];
export const metrics = [];
export function log(event) { logs.push(event); }
export function metric(event) { metrics.push(event); }
