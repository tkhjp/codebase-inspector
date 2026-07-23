import { z } from "zod";

const FiltersSchema = z.object({
  path: z.string().nullable(),
  language: z.string().nullable(),
  typeKind: z.string().nullable(),
  visibility: z.string().nullable(),
  name: z.string().nullable(),
  includeNonPublic: z.boolean(),
  omitDiagramMembers: z.boolean(),
  maxTypes: z.number().int().positive(),
  splitSize: z.number().int().positive(),
  splitBy: z.string()
}).strict();

const RelativePathSchema = z.string().min(1).refine((value) => (
  !value.startsWith("/")
  && !value.includes("\\")
  && !value.split("/").includes("..")
), "Expected a project-relative path");

export const StructureRenderReportSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  snapshotSchemaVersion: z.literal("2.0.0"),
  snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  filters: FiltersSchema,
  outputDirectory: RelativePathSchema,
  definitionOutput: RelativePathSchema,
  diagramOutput: RelativePathSchema,
  matchedTypeCount: z.number().int().nonnegative(),
  selectedTypeCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  omittedTypeCount: z.number().int().nonnegative(),
  parserFailureCount: z.number().int().nonnegative(),
  unsupportedFileCount: z.number().int().nonnegative(),
  parserIssues: z.array(z.object({
    path: RelativePathSchema,
    status: z.enum(["warning", "unsupported"])
  }).strict()),
  unresolvedRelationCount: z.number().int().nonnegative(),
  unresolvedRelations: z.array(z.object({
    sourceId: z.string().min(1),
    kind: z.string().min(1),
    origin: z.string().min(1),
    targetName: z.string().min(1)
  }).strict()),
  omittedRelationCount: z.number().int().nonnegative(),
  resolvedCallCount: z.number().int().nonnegative(),
  unresolvedCallCount: z.number().int().nonnegative(),
  ambiguousCallCount: z.number().int().nonnegative(),
  dynamicCallCount: z.number().int().nonnegative(),
  unresolvedCalls: z.array(z.object({
    callerId: z.string().min(1),
    calleeText: z.string().min(1),
    filePath: RelativePathSchema,
    lineNumber: z.number().int().positive(),
    reason: z.string().min(1),
    candidateIds: z.array(z.string().min(1))
  }).strict()),
  outputs: z.array(RelativePathSchema)
}).strict();

export const parseStructureRenderReport = (value) => StructureRenderReportSchema.parse(value);
