import { z } from "zod";
import { LineRangeSchema, ParameterSchema, PropertySchema, VisibilitySchema } from "./raw-analysis.mjs";

const IdSchema = z.string().min(1);
const FilePathSchema = z.string().min(1);
const TypeKindSchema = z.enum(["class", "interface", "struct", "enum", "trait", "module"]);
const CoverageSchema = z.object({
  trackedFiles: z.number().int().nonnegative(),
  supportedFiles: z.number().int().nonnegative(),
  parsedFiles: z.number().int().nonnegative(),
  warningFiles: z.number().int().nonnegative(),
  unsupportedFiles: z.number().int().nonnegative()
}).strict();

const CanonicalCallableFields = {
  id: IdSchema,
  name: z.string().min(1),
  filePath: FilePathSchema,
  lineRange: LineRangeSchema,
  parameters: z.array(ParameterSchema),
  returnType: z.string().min(1).nullable(),
  visibility: VisibilitySchema,
  async: z.boolean().nullable(),
  exported: z.boolean().nullable()
};

const ProjectSchema = z.object({
  name: z.string().min(1),
  root: z.string().min(1).nullable(),
  gitCommitHash: z.string().min(1),
  workingTreeDirty: z.boolean(),
  languages: z.array(z.string().min(1)),
  skillVersion: z.string().min(1)
}).strict();

const FileSchema = z.object({
  id: IdSchema,
  path: FilePathSchema,
  language: z.string().min(1),
  category: z.enum(["source", "test", "entrypoint", "unsupported"]),
  lineCount: z.number().int().nonnegative(),
  parseStatus: z.enum(["parsed", "unsupported", "warning"]),
  typeIds: z.array(IdSchema),
  methodIds: z.array(IdSchema),
  functionIds: z.array(IdSchema)
}).strict();

const TypeSchema = z.object({
  id: IdSchema,
  kind: TypeKindSchema,
  name: z.string().min(1),
  filePath: FilePathSchema,
  lineRange: LineRangeSchema,
  properties: z.array(PropertySchema),
  methodIds: z.array(IdSchema),
  extends: z.array(z.string()),
  implements: z.array(z.string()),
  exported: z.boolean().nullable()
}).strict();

const MethodSchema = z.object({
  ...CanonicalCallableFields,
  ownerTypeId: IdSchema,
  static: z.boolean().nullable()
}).strict();

const FunctionSchema = z.object(CanonicalCallableFields).strict();

const ImportSchema = z.object({
  sourceFileId: IdSchema,
  targetFileId: IdSchema,
  source: z.string().min(1),
  lineNumber: z.number().int().positive()
}).strict();

const CallSchema = z.object({
  callerId: IdSchema,
  calleeId: IdSchema,
  filePath: FilePathSchema,
  lineNumber: z.number().int().positive()
}).strict();

const UnresolvedCallSchema = z.object({
  callerId: IdSchema.nullable(),
  calleeText: z.string().min(1),
  filePath: FilePathSchema,
  lineNumber: z.number().int().positive(),
  reason: z.enum(["caller-not-found", "callee-not-found", "ambiguous-callee", "dynamic-call"])
}).strict();

function addDanglingReference(context, path, value) {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message: `Dangling reference: ${value}` });
}

function addDuplicateId(context, collection, label, index, id) {
  context.addIssue({ code: z.ZodIssueCode.custom, path: [collection, index, "id"], message: `Duplicate ${label} ID: ${id}` });
}

export const SymbolIndexSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  project: ProjectSchema,
  files: z.array(FileSchema),
  types: z.array(TypeSchema),
  methods: z.array(MethodSchema),
  functions: z.array(FunctionSchema),
  imports: z.array(ImportSchema),
  calls: z.array(CallSchema),
  unresolvedCalls: z.array(UnresolvedCallSchema),
  coverage: CoverageSchema
}).strict().superRefine((index, context) => {
  const fileIds = new Set(index.files.map((file) => file.id));
  const filePaths = new Set(index.files.map((file) => file.path));
  const typeIds = new Set(index.types.map((type) => type.id));
  const methodIds = new Set(index.methods.map((method) => method.id));
  const functionIds = new Set(index.functions.map((func) => func.id));
  const callableIds = new Set([...methodIds, ...functionIds]);

  [["files", "File", index.files], ["types", "Type", index.types], ["methods", "Method", index.methods], ["functions", "Function", index.functions]].forEach(([collection, label, records]) => {
    const seenIds = new Set();
    records.forEach((record, recordIndex) => {
      if (seenIds.has(record.id)) addDuplicateId(context, collection, label, recordIndex, record.id);
      seenIds.add(record.id);
    });
  });

  index.files.forEach((file, fileIndex) => {
    file.typeIds.forEach((id, idIndex) => {
      if (!typeIds.has(id)) addDanglingReference(context, ["files", fileIndex, "typeIds", idIndex], id);
    });
    file.methodIds.forEach((id, idIndex) => {
      if (!methodIds.has(id)) addDanglingReference(context, ["files", fileIndex, "methodIds", idIndex], id);
    });
    file.functionIds.forEach((id, idIndex) => {
      if (!functionIds.has(id)) addDanglingReference(context, ["files", fileIndex, "functionIds", idIndex], id);
    });
  });

  index.types.forEach((type, typeIndex) => {
    if (!filePaths.has(type.filePath)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["types", typeIndex, "filePath"], message: `Type filePath must reference an existing File path: ${type.filePath}` });
    }
    type.methodIds.forEach((id, idIndex) => {
      if (!methodIds.has(id)) addDanglingReference(context, ["types", typeIndex, "methodIds", idIndex], id);
    });
  });

  index.methods.forEach((method, methodIndex) => {
    if (!filePaths.has(method.filePath)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["methods", methodIndex, "filePath"], message: `Method filePath must reference an existing File path: ${method.filePath}` });
    }
    if (!typeIds.has(method.ownerTypeId)) addDanglingReference(context, ["methods", methodIndex, "ownerTypeId"], method.ownerTypeId);
  });

  index.functions.forEach((func, functionIndex) => {
    if (!filePaths.has(func.filePath)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["functions", functionIndex, "filePath"], message: `Function filePath must reference an existing File path: ${func.filePath}` });
    }
  });

  index.imports.forEach((record, importIndex) => {
    if (!fileIds.has(record.sourceFileId)) addDanglingReference(context, ["imports", importIndex, "sourceFileId"], record.sourceFileId);
    if (!fileIds.has(record.targetFileId)) addDanglingReference(context, ["imports", importIndex, "targetFileId"], record.targetFileId);
  });

  index.calls.forEach((call, callIndex) => {
    if (!callableIds.has(call.callerId)) addDanglingReference(context, ["calls", callIndex, "callerId"], call.callerId);
    if (!callableIds.has(call.calleeId)) addDanglingReference(context, ["calls", callIndex, "calleeId"], call.calleeId);
  });

  index.unresolvedCalls.forEach((call, callIndex) => {
    if (call.callerId !== null && !callableIds.has(call.callerId)) addDanglingReference(context, ["unresolvedCalls", callIndex, "callerId"], call.callerId);
  });
});

export const parseSymbolIndex = (value) => SymbolIndexSchema.parse(value);
