import { z } from "zod";

const CoverageSchema = z.object({
  trackedFiles: z.number().int().nonnegative(),
  supportedFiles: z.number().int().nonnegative(),
  parsedFiles: z.number().int().nonnegative(),
  warningFiles: z.number().int().nonnegative(),
  unsupportedFiles: z.number().int().nonnegative()
}).strict();

const ParserFailureSchema = z.object({
  filePath: z.string().min(1),
  warnings: z.array(z.string().min(1))
}).strict();

const RelationshipsV1Schema = z.object({
  internalImports: z.number().int().nonnegative(),
  externalImports: z.number().int().nonnegative(),
  unresolvedImports: z.number().int().nonnegative(),
  resolvedCalls: z.number().int().nonnegative(),
  unresolvedCalls: z.number().int().nonnegative()
}).strict();
const RelationshipsV2Schema = RelationshipsV1Schema.extend({
  ambiguousCalls: z.number().int().nonnegative(),
  dynamicCalls: z.number().int().nonnegative(),
  typeRelations: z.number().int().nonnegative()
}).strict();

const OptionsSchema = z.object({
  tracked: z.boolean(),
  output: z.string().min(1),
  keepIntermediate: z.boolean()
}).strict();

export const AnalysisReportV1Schema = z.object({
  schemaVersion: z.literal("1.0.0"),
  skillVersion: z.string().min(1),
  status: z.enum(["complete", "partial"]),
  coverage: CoverageSchema,
  warnings: z.array(z.string()),
  parserFailures: z.array(ParserFailureSchema),
  unsupportedFiles: z.array(z.string().min(1)),
  relationships: RelationshipsV1Schema,
  options: OptionsSchema
}).strict();

export const AnalysisReportV2Schema = z.object({
  schemaVersion: z.literal("2.0.0"),
  skillVersion: z.string().min(1),
  snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["complete", "partial"]),
  coverage: CoverageSchema,
  warnings: z.array(z.string()),
  parserFailures: z.array(ParserFailureSchema),
  unsupportedFiles: z.array(z.string().min(1)),
  relationships: RelationshipsV2Schema,
  languageCapabilities: z.array(z.object({
    language: z.string().min(1),
    level: z.enum(["baseline", "enriched"]),
    supportedFacts: z.array(z.string().min(1)),
    unsupportedFacts: z.array(z.string().min(1))
  }).strict()),
  options: OptionsSchema
}).strict();

export const AnalysisReportSchema = z.union([AnalysisReportV2Schema, AnalysisReportV1Schema]);
export const parseAnalysisReportV2 = (value) => AnalysisReportV2Schema.parse(value);
export const parseAnalysisReport = (value) => AnalysisReportSchema.parse(value);
