import { z } from "zod";
import { providers } from "@beyonder/compute";
const id = z.string().trim().min(1).max(160);
const note = z.string().max(2000).optional();
const simple = <T extends string>(type: T) => z.object({ type: z.literal(type) }).strict();
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("submitObjective"), objective: z.string().trim().min(3).max(8000) }).strict(),
  z.object({ type: z.literal("resumeTask"), taskId: id }).strict(),
  z.object({ type: z.literal("discoverOpportunities"), fixture: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("prepareApplication"), opportunityId: id }).strict(),
  z.object({ type: z.literal("approveAction"), approvalId: id }).strict(),
  z.object({ type: z.literal("rejectAction"), approvalId: id, reason: note }).strict(),
  simple("pauseRuntime"), simple("resumeRuntime"), simple("safeShutdown"), simple("emergencyStop"), simple("completeFirstRun"),
  z.object({ type: z.literal("setDeveloperMode"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("setStartup"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("setSecret"), providerId: id, envVar: id, value: z.string().min(1).max(16384), vaultPassword: z.string().min(12).max(256) }).strict(),
  z.object({ type: z.literal("confirmApplication"), workRunId: id, externalReference: z.string().max(1000).optional(), notes: note }).strict(),
  z.object({ type: z.literal("confirmSubmission"), workRunId: id, externalReference: z.string().max(1000).optional(), notes: note }).strict(),
  z.object({ type: z.literal("recordSettlement"), workRunId: id, amount: z.number().finite().positive(), currency: z.enum(["USD", "USDC"]), source: id, externalReference: z.string().min(1).max(1000) }).strict()
]);
export function validateCommand(value: unknown) {
  const command = commandSchema.parse(value);
  if (command.type === "setSecret" && !providers.find((provider) => provider.id === command.providerId)?.credentialEnvVars.includes(command.envVar as string)) throw new Error("Credencial incompatível com o provider.");
  if (command.type === "discoverOpportunities" && command.fixture && process.env.BEYONDER_CONTROL_FIXTURE !== "1") throw new Error("Dados de teste exigem modo fixture explícito.");
  return command;
}
