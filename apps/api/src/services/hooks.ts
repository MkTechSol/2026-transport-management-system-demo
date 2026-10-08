/**
 * Late-bound integration points so feature modules stay decoupled.
 * Finance registers accounting postings here (Phase B); until then these are no-ops.
 */
export const postHooks: {
  expenseApproved?: (expense: any, tx?: any) => Promise<void>;
  tripCompleted?: (trip: any, tx?: any) => Promise<void>;
} = {};
