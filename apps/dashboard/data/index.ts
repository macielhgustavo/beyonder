import type { DashboardDataSource } from "./source";
import { CapacityAwareDashboardDataSource } from "./capacity-aware";
import { EmptyDashboardDataSource } from "./empty";
import { LocalDashboardDataSource } from "./local";
import { MockDashboardDataSource } from "./mock";

export function getDashboardDataSource(): DashboardDataSource {
  const requested = process.env.BEYONDER_DASHBOARD_SOURCE?.toLowerCase();
  if (requested === "mock") return new MockDashboardDataSource();
  if (requested === "empty") return new EmptyDashboardDataSource();
  return new CapacityAwareDashboardDataSource(new LocalDashboardDataSource());
}

export type { DashboardDataSource } from "./source";
export * from "./types";
