import { Router } from 'express';
import { q, q1 } from '../db/sequelize';
import { wrap } from '../lib/http';
import { docStatusSql } from '../lib/sql';
import { TRIP_LIST_FROM, TRIP_LIST_SELECT } from '../services/trips';

export const meRouter = Router();

/** Mobile / driver home: one call returns everything the driver app needs on launch. */
meRouter.get('/home', wrap(async (req, res) => {
  const driverId = req.user!.driverId;
  if (!driverId) return res.json({ driver: null, activeTrips: [], upcomingTrips: [], documents: [], recentTrips: [] });
  const [driver, active, upcoming, documents, recent] = await Promise.all([
    q1(`SELECT d.id, d.employee_id, d.full_name, d.status, d.experience_years, d.safety_score, l.name AS home_plant_name FROM drivers d LEFT JOIN locations l ON l.id = d.home_plant_id WHERE d.id = :id`, { id: driverId }),
    q(`SELECT ${TRIP_LIST_SELECT} ${TRIP_LIST_FROM} WHERE t.driver_id = :id AND t.status IN ('DISPATCHED','IN_TRANSIT','DELAYED','ON_HOLD','ARRIVED','DELIVERED','RETURNING') ORDER BY t.scheduled_departure`, { id: driverId }),
    q(`SELECT ${TRIP_LIST_SELECT} ${TRIP_LIST_FROM} WHERE t.driver_id = :id AND t.status = 'ASSIGNED' ORDER BY t.scheduled_departure LIMIT 10`, { id: driverId }),
    q(`SELECT d.id, d.doc_type, d.expires_on, ${docStatusSql('d')} AS status, (d.expires_on - CURRENT_DATE)::int AS days_left FROM documents d WHERE d.driver_id = :id
        AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.doc_type = d.doc_type AND n.expires_on > d.expires_on AND n.driver_id = d.driver_id) ORDER BY d.expires_on`, { id: driverId }),
    q(`SELECT ${TRIP_LIST_SELECT} ${TRIP_LIST_FROM} WHERE t.driver_id = :id AND t.status IN ('COMPLETED') ORDER BY t.completed_at DESC LIMIT 5`, { id: driverId }),
  ]);
  res.json({ driver, activeTrips: active, upcomingTrips: upcoming, documents, recentTrips: recent });
}));
