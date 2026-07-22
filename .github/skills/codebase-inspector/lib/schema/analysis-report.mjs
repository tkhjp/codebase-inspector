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

const RelationshipsSchema = z.object({
  internalImports: z.number().int().nonnegative(),
  externalImports: z.number().int().nonnegative(),
  unresolvedImports: z.number().int().nonnegative(),
  resolvedCalls: z.number().int().nonnegative(),
  unresolvedCalls: z.number().int().nonnegative()
}).strict();

const OptionsSchema = z.object({
  tracked: z.boolean(),
  output: z.string().min(1),
  keepIntermediate: z.boolean()
}).strict();

export const AnalysisReportSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  skillVersion: z.string().min(1),
  status: z.enum(["complete", "partial"]),
  coverage: CoverageSchema,
  warnings: z.array(z.string()),
  parserFailures: z.array(ParserFailureSchema),
  unsupportedFiles: z.array(z.string().min(1)),
  relationships: RelationshipsSchema,
  options: OptionsSchema
}).strict();

export const parseAnalysisReport = (value) => AnalysisReportSchema.parse(value);
