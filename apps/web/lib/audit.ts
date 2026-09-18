import "server-only";
import { prisma, Prisma } from "@frodocodo/db";

export async function recordAuditEvent(params: {
  householdId: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditEvent.create({
    data: {
      householdId: params.householdId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
