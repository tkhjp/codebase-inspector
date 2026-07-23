import { z } from "zod";

export const LineRangeSchema = z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(([start, end]) => start <= end);
export const VisibilitySchema = z.enum(["public", "protected", "private", "internal", "package"]).nullable();
export const FactStatusSchema = z.enum(["known", "not-declared", "unsupported", "failed"]);
export const TypeKindSchema = z.enum(["class", "interface", "struct", "enum", "trait", "record", "module"]);
export const CallableKindSchema = z.enum(["method", "constructor", "function", "getter", "setter", "operator"]);
export const PropertyKindSchema = z.enum(["field", "property", "enum-member"]);
export const ParameterSchema = z.object({
  position: z.number().int().nonnegative().optional(),
  name: z.string().min(1),
  type: z.string().min(1).nullable(),
  typeStatus: FactStatusSchema.optional(),
  defaultValue: z.string().nullable().optional(),
  defaultStatus: FactStatusSchema.optional(),
  optional: z.boolean().optional(),
  variadic: z.boolean().optional()
}).strict();
export const PropertySchema = z.object({
  name: z.string().min(1),
  kind: PropertyKindSchema.optional(),
  type: z.string().min(1).nullable(),
  typeStatus: FactStatusSchema.optional(),
  defaultValue: z.string().nullable().optional(),
  defaultStatus: FactStatusSchema.optional(),
  visibility: VisibilitySchema,
  visibilityStatus: FactStatusSchema.optional(),
  modifiers: z.array(z.string().min(1)).optional(),
  static: z.boolean().nullable(),
  lineRange: LineRangeSchema.nullable(),
  explicitValue: z.string().nullable().optional()
}).strict();
export const RawTypeSchema = z.object({
  kind: TypeKindSchema,
  name: z.string().min(1),
  qualifiedName: z.string().min(1).optional(),
  lineRange: LineRangeSchema,
  namespace: z.string().min(1).nullable().optional(),
  package: z.string().min(1).nullable().optional(),
  module: z.string().min(1).nullable().optional(),
  visibility: VisibilitySchema.optional(),
  visibilityStatus: FactStatusSchema.optional(),
  modifiers: z.array(z.string().min(1)).optional(),
  typeParameters: z.array(z.string().min(1)).optional(),
  properties: z.array(PropertySchema),
  extends: z.array(z.string()),
  implements: z.array(z.string()),
  mixins: z.array(z.string()).optional(),
  exported: z.boolean().nullable()
}).strict();

const CallableFields = {
  name: z.string().min(1),
  kind: CallableKindSchema.optional(),
  lineRange: LineRangeSchema,
  parameters: z.array(ParameterSchema),
  returnType: z.string().min(1).nullable(),
  returnTypeStatus: FactStatusSchema.optional(),
  visibility: VisibilitySchema,
  visibilityStatus: FactStatusSchema.optional(),
  modifiers: z.array(z.string().min(1)).optional(),
  typeParameters: z.array(z.string().min(1)).optional(),
  async: z.boolean().nullable(),
  exported: z.boolean().nullable()
};

export const RawMethodSchema = z.object({ ...CallableFields, ownerName: z.string().min(1), static: z.boolean().nullable() }).strict();
export const RawFunctionSchema = z.object(CallableFields).strict();
export const ImportCandidateSchema = z.object({ source: z.string().min(1), specifiers: z.array(z.string()), lineNumber: z.number().int().positive(), kind: z.enum(["module", "include", "source"]) }).strict();
export const CallCandidateSchema = z.object({
  callerName: z.string().min(1).nullable(),
  callerOwnerName: z.string().min(1).nullable(),
  calleeText: z.string().min(1),
  receiverText: z.string().min(1).nullable().optional(),
  argumentCount: z.number().int().nonnegative().nullable().optional(),
  lineNumber: z.number().int().positive()
}).strict();
export const RawFileAnalysisSchema = z.object({
  filePath: z.string().min(1),
  language: z.string().min(1),
  namespace: z.string().min(1).nullable().optional(),
  package: z.string().min(1).nullable().optional(),
  module: z.string().min(1).nullable().optional(),
  capabilityLevel: z.enum(["baseline", "enriched"]).optional(),
  supportedFacts: z.array(z.string().min(1)).optional(),
  unsupportedFacts: z.array(z.string().min(1)).optional(),
  types: z.array(RawTypeSchema),
  methods: z.array(RawMethodSchema),
  functions: z.array(RawFunctionSchema),
  importCandidates: z.array(ImportCandidateSchema),
  callCandidates: z.array(CallCandidateSchema),
  warnings: z.array(z.string())
}).strict();

export const parseRawFileAnalysis = (value) => RawFileAnalysisSchema.parse(value);
