import type { Db } from "../../db/client.js";
import type { MissionSnapshot } from "../contracts/mission.js";
import type { MissionEvent, MissionEventStore } from "../events/mission-events.js";
import { MISSION_EVENT_SCHEMA_VERSION } from "../events/mission-events.js";
import type { EvidenceRecord, ClaimEvidenceRelation, EvidenceStore } from "../evidence/evidence.js";
import { EVIDENCE_SCHEMA_VERSION } from "../evidence/evidence.js";
import type { ActionIntent, ActionReceipt, ActionStore } from "../actions/action-protocol.js";
import { ACTION_INTENT_SCHEMA_VERSION } from "../actions/action-protocol.js";
import { eq, desc, sql, and, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { missions, missionNodes, missionEvents, missionEdges, evidence, claimEvidenceRelations, actionIntents, actionReceipts, capabilities } from "../../db/schema.js";

export interface MissionStore {
  create(mission: MissionSnapshot): Promise<MissionSnapshot>;
  get(missionId: string): Promise<MissionSnapshot | undefined>;
  update(mission: MissionSnapshot): Promise<void>;
  list(limit?: number): Promise<MissionSnapshot[]>;
  delete(missionId: string): Promise<void>;
}

export class SqliteMissionStore implements MissionStore {
  constructor(private readonly db: Db) {}

  async create(mission: MissionSnapshot): Promise<MissionSnapshot> {
    const now = new Date().toISOString();
    await this.db.insert(missions).values({
      id: mission.missionId,
      contract: JSON.stringify(mission.contract),
      snapshot: JSON.stringify(mission),
      createdAt: now,
      updatedAt: now
    });
    for (const node of mission.nodes) {
      await this.db.insert(missionNodes).values({
        id: node.id,
        missionId: mission.missionId,
        spec: JSON.stringify(node.spec),
        state: node.state,
        attempt: node.attempt,
        outcome: node.outcome ? JSON.stringify(node.outcome) : null,
        createdAt: now,
        updatedAt: now
      });
    }
    // Edges from dependencies
    for (const node of mission.nodes) {
      for (const dep of node.spec.dependsOn) {
        await this.db.insert(missionEdges).values({
          id: nanoid(),
          missionId: mission.missionId,
          fromNodeId: dep,
          toNodeId: node.id
        });
      }
    }
    return mission;
  }

  async get(missionId: string): Promise<MissionSnapshot | undefined> {
    const rows = await this.db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return JSON.parse(row.snapshot) as MissionSnapshot;
  }

  async update(mission: MissionSnapshot): Promise<void> {
    await this.db
      .update(missions)
      .set({ snapshot: JSON.stringify(mission), updatedAt: new Date().toISOString() })
      .where(eq(missions.id, mission.missionId));

    // Sync nodes
    for (const node of mission.nodes) {
      await this.db
        .insert(missionNodes)
        .values({
          id: node.id,
          missionId: mission.missionId,
          spec: JSON.stringify(node.spec),
          state: node.state,
          attempt: node.attempt,
          outcome: node.outcome ? JSON.stringify(node.outcome) : null,
          createdAt: new Date().toISOString(), // will be ignored on conflict
          updatedAt: new Date().toISOString()
        })
        .onConflictDoUpdate({
          target: missionNodes.id,
          set: { state: node.state, attempt: node.attempt, outcome: node.outcome ? JSON.stringify(node.outcome) : null, updatedAt: new Date().toISOString() }
        });
    }
  }

  async list(limit = 50): Promise<MissionSnapshot[]> {
    const rows = await this.db.select().from(missions).orderBy(desc(missions.updatedAt)).limit(limit);
    return rows.map((row) => JSON.parse(row.snapshot) as MissionSnapshot);
  }

  async delete(missionId: string): Promise<void> {
    await this.db.delete(missions).where(eq(missions.id, missionId));
  }
}

export class SqliteMissionEventStore implements MissionEventStore {
  constructor(private readonly db: Db) {}

  async append(event: MissionEvent): Promise<void> {
    // Idempotent insert — (missionId, seq) unique constraint enforced by index
    await this.db
      .insert(missionEvents)
      .values({
        id: nanoid(),
        missionId: event.missionId,
        seq: event.seq,
        type: event.type,
        payload: JSON.stringify(event.payload),
        recordedAt: event.recordedAt
      })
      .onConflictDoNothing(); // relies on unique index
  }

  async list(missionId: string, afterSeq?: number, limit = 1000): Promise<MissionEvent[]> {
    const rows = await this.db
      .select()
      .from(missionEvents)
      .where(
        afterSeq === undefined
          ? eq(missionEvents.missionId, missionId)
          : and(eq(missionEvents.missionId, missionId), gt(missionEvents.seq, afterSeq))
      )
      .orderBy(missionEvents.seq)
      .limit(limit);
    return rows.map((row) => ({
      schemaVersion: MISSION_EVENT_SCHEMA_VERSION,
      seq: row.seq,
      missionId: row.missionId,
      type: row.type as MissionEvent["type"],
      recordedAt: row.recordedAt,
      payload: JSON.parse(row.payload)
    }));
  }

  async lastSeq(missionId: string): Promise<number> {
    const row = await this.db
      .select({ seq: missionEvents.seq })
      .from(missionEvents)
      .where(eq(missionEvents.missionId, missionId))
      .orderBy(desc(missionEvents.seq))
      .limit(1);
    return row[0]?.seq ?? 0;
  }
}

export class SqliteEvidenceStore implements EvidenceStore {
  constructor(private readonly db: Db) {}

  async attach(evidenceRecord: EvidenceRecord): Promise<void> {
    await this.db.insert(evidence).values({
      id: evidenceRecord.id,
      missionId: evidenceRecord.missionId,
      nodeId: evidenceRecord.nodeId,
      evidenceKind: evidenceRecord.evidenceKind,
      description: evidenceRecord.description,
      provenance: JSON.stringify(evidenceRecord.provenance),
      contentHash: evidenceRecord.contentHash,
      trust: evidenceRecord.trust,
      confidence: evidenceRecord.confidence,
      artifactRef: evidenceRecord.artifactRef,
      recordedAt: evidenceRecord.recordedAt
    }).onConflictDoNothing();
  }

  async get(evidenceId: string): Promise<EvidenceRecord | undefined> {
    const rows = await this.db.select().from(evidence).where(eq(evidence.id, evidenceId)).limit(1);
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      id: row.id,
      missionId: row.missionId,
      nodeId: row.nodeId ?? undefined,
      evidenceKind: row.evidenceKind,
      description: row.description,
      provenance: JSON.parse(row.provenance),
      contentHash: row.contentHash,
      trust: row.trust as "UNTRUSTED" | "SEMI_TRUSTED" | "TRUSTED",
      confidence: row.confidence,
      artifactRef: row.artifactRef ?? undefined,
      recordedAt: row.recordedAt
    };
  }

  async listByMission(missionId: string): Promise<EvidenceRecord[]> {
    const rows = await this.db.select().from(evidence).where(eq(evidence.missionId, missionId));
    return rows.map((row) => ({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      id: row.id,
      missionId: row.missionId,
      nodeId: row.nodeId ?? undefined,
      evidenceKind: row.evidenceKind,
      description: row.description,
      provenance: JSON.parse(row.provenance),
      contentHash: row.contentHash,
      trust: row.trust as "UNTRUSTED" | "SEMI_TRUSTED" | "TRUSTED",
      confidence: row.confidence,
      artifactRef: row.artifactRef ?? undefined,
      recordedAt: row.recordedAt
    }));
  }

  async relateClaim(relation: ClaimEvidenceRelation): Promise<void> {
    await this.db.insert(claimEvidenceRelations).values({
      id: nanoid(),
      missionId: relation.missionId,
      claimId: relation.claimId,
      claim: relation.claim,
      evidenceId: relation.evidenceId,
      relation: relation.relation,
      assessedAt: relation.assessedAt
    });
  }

  async claimRelations(missionId: string, claimId: string): Promise<ClaimEvidenceRelation[]> {
    const rows = await this.db
      .select()
      .from(claimEvidenceRelations)
      .where(sql`${claimEvidenceRelations.missionId} = ${missionId} AND ${claimEvidenceRelations.claimId} = ${claimId}`);
    return rows.map((row) => ({
      missionId: row.missionId,
      claimId: row.claimId,
      claim: row.claim,
      evidenceId: row.evidenceId,
      relation: row.relation as ClaimEvidenceRelation["relation"],
      assessedAt: row.assessedAt
    }));
  }
}

export class SqliteActionStore implements ActionStore {
  constructor(private readonly db: Db) {}

  async saveIntent(intent: ActionIntent): Promise<void> {
    // Plain insert: duplicate idempotencyKey (invariant 6) must be rejected
    // by SQLite's UNIQUE constraint, not silently ignored.
    await this.db.insert(actionIntents).values({
      id: intent.id,
      missionId: intent.missionId,
      nodeId: intent.nodeId,
      what: intent.what,
      why: intent.why,
      target: intent.target,
      parameters: JSON.stringify(intent.parameters),
      idempotencyKey: intent.idempotencyKey,
      risk: intent.risk,
      sideEffectLevel: intent.sideEffectLevel,
      requiresApproval: intent.requiresApproval,
      approvalActionType: intent.approvalActionType,
      expiresAt: intent.expiresAt,
      createdAt: intent.createdAt
    });
  }

  async getIntent(intentId: string): Promise<ActionIntent | undefined> {
    const rows = await this.db.select().from(actionIntents).where(eq(actionIntents.id, intentId)).limit(1);
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return {
      schemaVersion: ACTION_INTENT_SCHEMA_VERSION,
      id: row.id,
      missionId: row.missionId,
      nodeId: row.nodeId,
      what: row.what,
      why: row.why,
      target: row.target,
      parameters: JSON.parse(row.parameters),
      idempotencyKey: row.idempotencyKey,
      risk: row.risk as ActionIntent["risk"],
      sideEffectLevel: row.sideEffectLevel as ActionIntent["sideEffectLevel"],
      requiresApproval: !!row.requiresApproval,
      approvalActionType: row.approvalActionType ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      createdAt: row.createdAt
    };
  }

  async listIntentsByMission(missionId: string): Promise<ActionIntent[]> {
    const rows = await this.db.select().from(actionIntents).where(eq(actionIntents.missionId, missionId));
    return rows.map((row) => ({
      schemaVersion: ACTION_INTENT_SCHEMA_VERSION,
      id: row.id,
      missionId: row.missionId,
      nodeId: row.nodeId,
      what: row.what,
      why: row.why,
      target: row.target,
      parameters: JSON.parse(row.parameters),
      idempotencyKey: row.idempotencyKey,
      risk: row.risk as ActionIntent["risk"],
      sideEffectLevel: row.sideEffectLevel as ActionIntent["sideEffectLevel"],
      requiresApproval: !!row.requiresApproval,
      approvalActionType: row.approvalActionType ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      createdAt: row.createdAt
    }));
  }

  async saveReceipt(receipt: ActionReceipt): Promise<void> {
    await this.db.insert(actionReceipts).values({
      id: receipt.id,
      actionIntentId: receipt.actionIntentId,
      provider: receipt.provider,
      externalId: receipt.externalId,
      result: receipt.result ? JSON.stringify(receipt.result) : null,
      observedEffect: receipt.observedEffect,
      state: receipt.state,
      committedAt: receipt.committedAt,
      reconciledAt: receipt.reconciledAt,
      error: receipt.error
    });
  }

  async getReceipt(receiptId: string): Promise<ActionReceipt | undefined> {
    const rows = await this.db.select().from(actionReceipts).where(eq(actionReceipts.id, receiptId)).limit(1);
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return {
      schemaVersion: ACTION_INTENT_SCHEMA_VERSION,
      id: row.id,
      actionIntentId: row.actionIntentId,
      provider: row.provider,
      externalId: row.externalId ?? undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
      observedEffect: row.observedEffect ?? undefined,
      state: row.state as ActionReceipt["state"],
      committedAt: row.committedAt,
      reconciledAt: row.reconciledAt ?? undefined,
      error: row.error ?? undefined
    };
  }

  async listReceiptsByIntent(actionIntentId: string): Promise<ActionReceipt[]> {
    const rows = await this.db.select().from(actionReceipts).where(eq(actionReceipts.actionIntentId, actionIntentId));
    return rows.map((row) => ({
      schemaVersion: ACTION_INTENT_SCHEMA_VERSION,
      id: row.id,
      actionIntentId: row.actionIntentId,
      provider: row.provider,
      externalId: row.externalId ?? undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
      observedEffect: row.observedEffect ?? undefined,
      state: row.state as ActionReceipt["state"],
      committedAt: row.committedAt,
      reconciledAt: row.reconciledAt ?? undefined,
      error: row.error ?? undefined
    }));
  }
}

export class SqliteCapabilityStore {
  constructor(private readonly db: Db) {}

  async upsert(capability: { id: string; contract: object; availability: string; implementations: object[] }): Promise<void> {
    await this.db
      .insert(capabilities)
      .values({
        id: capability.id,
        contract: JSON.stringify(capability.contract),
        availability: capability.availability,
        implementations: JSON.stringify(capability.implementations),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .onConflictDoUpdate({
        target: capabilities.id,
        set: { contract: JSON.stringify(capability.contract), availability: capability.availability, implementations: JSON.stringify(capability.implementations), updatedAt: new Date().toISOString() }
      });
  }

  async list(): Promise<Array<{ id: string; contract: object; availability: string; implementations: object[] }>> {
    const rows = await this.db.select().from(capabilities);
    return rows.map((row) => ({
      id: row.id,
      contract: JSON.parse(row.contract),
      availability: row.availability,
      implementations: JSON.parse(row.implementations)
    }));
  }
}

// Re-export schema version constants for convenience
export { MISSION_EVENT_SCHEMA_VERSION } from "../events/mission-events.js";
export { EVIDENCE_SCHEMA_VERSION } from "../evidence/evidence.js";
export { ACTION_INTENT_SCHEMA_VERSION } from "../actions/action-protocol.js";
export { CAPABILITY_SCHEMA_VERSION } from "../capabilities/capabilities.js";