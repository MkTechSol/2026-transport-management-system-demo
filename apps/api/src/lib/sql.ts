/** SQL expression for document status, evaluated by the database (single source of truth for dashboards & lists). */
export const docStatusSql = (alias = 'd') =>
  `CASE WHEN ${alias}.expires_on < CURRENT_DATE THEN 'EXPIRED'
        WHEN ${alias}.expires_on <= CURRENT_DATE + 30 THEN 'EXPIRING_SOON'
        ELSE 'ACTIVE' END`;

export const EXEC_STATUS_SQL = `('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING')`;
export const RESERVING_STATUS_SQL = `('ASSIGNED','DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING')`;
export const MOVING_STATUS_SQL = `('IN_TRANSIT','DELAYED','RETURNING')`;

/** Only the newest document of each type per vehicle/driver is "current"; renewed (superseded) ones are history. */
/** True when no newer document of the same type exists for the same vehicle/driver. Written with plain equality so the (vehicle_id, doc_type) / (driver_id, doc_type) indexes are used. */
export const currentDocSql = (alias = 'd') =>
  `NOT EXISTS (SELECT 1 FROM documents n WHERE n.doc_type = ${alias}.doc_type AND n.expires_on > ${alias}.expires_on
      AND ((${alias}.vehicle_id IS NOT NULL AND n.vehicle_id = ${alias}.vehicle_id) OR (${alias}.driver_id IS NOT NULL AND n.driver_id = ${alias}.driver_id)))`;

import { config } from '../config';
/** Start of the current business day (Asia/Karachi by default) as timestamptz. */
export const TODAY_START = `(date_trunc('day', now() AT TIME ZONE '${config.BUSINESS_TZ}') AT TIME ZONE '${config.BUSINESS_TZ}')`;
export const localDate = (col: string) => `(${col} AT TIME ZONE '${config.BUSINESS_TZ}')::date`;
