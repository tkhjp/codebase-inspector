import { z } from "zod";

export const LineRangeSchema = z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(([start, end]) => start <= end);
export const VisibilitySchema = z.enum(["public", "protected", "private", "internal", "package"]).nullable();
export const ParameterSchema = z.object({ name: z.string().min(1), type: z.string().min(1).nullable() }).strict();
export const PropertySchema = z.object({ name: z.string().min(1), type: z.string().min(1).nullable(), visibility: VisibilitySchema, static: z.boolean().nullable(), lineRange: LineRangeSchema.nullable() }).strict();
export const RawTypeSchema = z.object({ kind: z.enum(["class", "interface", "struct", "enum", "trait", "module"]), name: z.string().min(1), lineRange: LineRangeSchema, properties: z.array(PropertySchema), extends: z.array(z.string()), implements: z.array(z.string()), exported: z.boolean().nullable() }).strict();

const CallableFields = {
  name: z.string().min(1),
  lineRange: LineRangeSchema,
  parameters: z.array(ParameterSchema),
  returnType: z.string().min(1).nullable(),
  visibility: VisibilitySchema,
  async: z.boolean().nullable(),
  exported: z.boolean().nullable()
};

export const RawMethodSchema = z.object({ ...CallableFields, ownerName: z.string().min(1), static: z.boolean().nullable() }).strict();
export const RawFunctionSchema = z.object(CallableFields).strict();
export const ImportCandidateSchema = z.object({ source: z.string().min(1), specifiers: z.array(z.string()), lineNumber: z.number().int().positive(), kind: z.enum(["module", "include", "source"]) }).strict();
export const CallCandidateSchema = z.object({ callerName: z.string().min(1).nullable(), callerOwnerName: z.string().min(1).nullable(), calleeText: z.string().min(1), lineNumber: z.number().int().positive() }).strict();
export const RawFileAnalysisSchema = z.object({ filePath: z.string().min(1), language: z.string().min(1), types: z.array(RawTypeSchema), methods: z.array(RawMethodSchema), functions: z.array(RawFunctionSchema), importCandidates: z.array(ImportCandidateSchema), callCandidates: z.array(CallCandidateSchema), warnings: z.array(z.string()) }).strict();

export const parseRawFileAnalysis = (value) => RawFileAnalysisSchema.parse(value);
