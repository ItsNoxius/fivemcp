import { z } from "zod";

import { DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT } from "./constants";

const NonEmptyStringSchema = z.string().trim().min(1);
const OptionalTextSchema = z.string().trim().max(10_000).optional();

export const CapabilityFlagsSchema = z.object({
  canStartServer: z.literal(false),
  canRestartServer: z.literal(false),
  canShutdownServer: z.literal(true),
});

export const StatusSchema = z.object({
  resourceName: NonEmptyStringSchema,
  resourceVersion: z.string().trim().default("0.1.0"),
  serverName: NonEmptyStringSchema,
  hostname: NonEmptyStringSchema,
  playerCount: z.number().int().min(0),
  maxClients: z.number().int().min(0),
  capabilities: CapabilityFlagsSchema,
});

export const PlayerSchema = z.object({
  serverId: z.number().int().min(1),
  name: NonEmptyStringSchema,
  ping: z.number().int().min(0),
  identifiers: z.array(NonEmptyStringSchema),
});

export const PlayersResponseSchema = z.object({
  players: z.array(PlayerSchema),
});

export const ResourceSchema = z.object({
  name: NonEmptyStringSchema,
  state: NonEmptyStringSchema,
  author: z.string().nullable(),
  version: z.string().nullable(),
  description: z.string().nullable(),
  path: z.string().nullable(),
});

export const ResourcesResponseSchema = z.object({
  resources: z.array(ResourceSchema),
});

export const AuditEntrySchema = z.object({
  id: NonEmptyStringSchema,
  timestamp: NonEmptyStringSchema,
  action: NonEmptyStringSchema,
  target: z.string().nullable(),
  origin: NonEmptyStringSchema,
  success: z.boolean(),
  error: z.string().nullable(),
});

export const AuditResponseSchema = z.object({
  audit: z.array(AuditEntrySchema),
});

export const SuccessEnvelopeSchema = z.object({
  ok: z.literal(true),
});

export const ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    status: z.number().int().min(400).max(599),
    details: OptionalTextSchema,
  }),
});

export const ActionResultSchema = SuccessEnvelopeSchema.extend({
  action: NonEmptyStringSchema,
  target: z.string().nullable(),
  message: NonEmptyStringSchema,
  auditEntry: AuditEntrySchema,
});

export const AnnounceRequestSchema = z.object({
  message: z.string().trim().min(1).max(512),
});

export const EmptyObjectSchema = z.object({}).strict();

export const PlayerParamsSchema = z.object({
  serverId: z.coerce.number().int().min(1),
});

export const ResourceParamsSchema = z.object({
  resourceName: NonEmptyStringSchema,
});

export const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_AUDIT_LIMIT).default(DEFAULT_AUDIT_LIMIT),
});

export const CommandActionSchema = z.enum([
  "start_resource",
  "stop_resource",
  "restart_resource",
  "ensure_resource",
  "refresh_resources",
  "broadcast_message",
  "shutdown_server",
]);

export const ToolErrorStructuredContentSchema = z.object({
  ok: z.literal(false),
  status: z.number().int().min(400).max(599),
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  details: OptionalTextSchema,
});

export const RouteDescriptorSchema = z.object({
  method: z.enum(["GET", "POST"]),
  path: NonEmptyStringSchema,
});

export type CapabilityFlags = z.infer<typeof CapabilityFlagsSchema>;
export type StatusResponse = z.infer<typeof StatusSchema>;
export type Player = z.infer<typeof PlayerSchema>;
export type PlayersResponse = z.infer<typeof PlayersResponseSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type ResourcesResponse = z.infer<typeof ResourcesResponseSchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export type AuditResponse = z.infer<typeof AuditResponseSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
export type AnnounceRequest = z.infer<typeof AnnounceRequestSchema>;
export type PlayerParams = z.infer<typeof PlayerParamsSchema>;
export type ResourceParams = z.infer<typeof ResourceParamsSchema>;
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
export type CommandAction = z.infer<typeof CommandActionSchema>;
export type ToolErrorStructuredContent = z.infer<
  typeof ToolErrorStructuredContentSchema
>;
