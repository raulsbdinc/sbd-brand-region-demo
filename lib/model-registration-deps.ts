// REAL MANAGEMENT DEPS FOR THE MODEL 3 / MODEL 4 EXECUTOR (server-only)
// =====================================================================
// The production wiring for lib/model-registration.ts. It is the ONLY place
// that binds the executor's injected `ManagementDeps` to the real, server-only
// Auth0 Management client. Keeping this split lets the executor stay free of a
// top-level `server-only` import so its rollback sequencing is unit-testable,
// while every actual tenant call still goes through this server-only module.

import "server-only"
import {
  createUser,
  deleteUser,
  getUser,
  getUsersByEmail,
  linkIdentity,
  unlinkIdentity,
  updateUser,
} from "@/lib/auth0-management"
import type { ManagementDeps } from "@/lib/model-registration"

export const realManagementDeps: ManagementDeps = {
  createUser,
  deleteUser,
  getUser,
  getUsersByEmail,
  linkIdentity,
  unlinkIdentity,
  updateUser,
}
