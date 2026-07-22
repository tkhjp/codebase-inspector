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

function addInvariantIssue(context, path, message) {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function addDuplicateId(context, collection, label, index, id) {
  addInvariantIssue(context, [collection, index, "id"], `Duplicate ${label} ID: ${id}`);
}

function countOccurrences(values, value) {
  return values.filter((entry) => entry === value).length;
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
  const collections = [["files", "File", index.files], ["types", "Type", index.types], ["methods", "Method", index.methods], ["functions", "Function", index.functions]];
  const globalIds = new Set();
  collections.forEach(([collection, label, records]) => {
    const seenIds = new Set();
    records.forEach((record, recordIndex) => {
      if (seenIds.has(record.id)) addDuplicateId(context, collection, label, recordIndex, record.id);
      if (globalIds.has(record.id)) addInvariantIssue(context, [collection, recordIndex, "id"], `Duplicate global ID: ${record.id}`);
      seenIds.add(record.id);
      globalIds.add(record.id);
    });
  });

  const fileIds = new Set(index.files.map((file) => file.id));
  const fileByPath = new Map();
  index.files.forEach((file, fileIndex) => {
    if (fileByPath.has(file.path)) addInvariantIssue(context, ["files", fileIndex, "path"], `Duplicate File path: ${file.path}`);
    fileByPath.set(file.path, file);
  });
  const typeById = new Map(index.types.map((type) => [type.id, type]));
  const methodById = new Map(index.methods.map((method) => [method.id, method]));
  const functionById = new Map(index.functions.map((func) => [func.id, func]));
  const callableById = new Map([...methodById, ...functionById]);

  index.files.forEach((file, fileIndex) => {
    [["typeIds", "Type", typeById], ["methodIds", "Method", methodById], ["functionIds", "Function", functionById]].forEach(([field, label, recordsById]) => {
      const seenIds = new Set();
      file[field].forEach((id, idIndex) => {
        if (seenIds.has(id)) addInvariantIssue(context, ["files", fileIndex, field, idIndex], `Duplicate File ${field} entry: ${id}`);
        seenIds.add(id);
        const record = recordsById.get(id);
        if (!record) addDanglingReference(context, ["files", fileIndex, field, idIndex], id);
        else if (record.filePath !== file.path) {
          addInvariantIssue(context, ["files", fileIndex, field, idIndex], `${label} ${field} entry must belong to matching File path: ${id}`);
        }
      });
    });
  });

  index.types.forEach((type, typeIndex) => {
    const file = fileByPath.get(type.filePath);
    if (!file) {
      addInvariantIssue(context, ["types", typeIndex, "filePath"], `Type filePath must reference an existing File path: ${type.filePath}`);
    } else if (countOccurrences(file.typeIds, type.id) !== 1) {
      addInvariantIssue(context, ["types", typeIndex, "id"], `Missing Type membership in matching File: ${type.id}`);
    }
    const seenMethodIds = new Set();
    type.methodIds.forEach((id, idIndex) => {
      if (seenMethodIds.has(id)) addInvariantIssue(context, ["types", typeIndex, "methodIds", idIndex], `Duplicate Type methodIds entry: ${id}`);
      seenMethodIds.add(id);
      const method = methodById.get(id);
      if (!method) addDanglingReference(context, ["types", typeIndex, "methodIds", idIndex], id);
      else if (method.ownerTypeId !== type.id || method.filePath !== type.filePath) {
        addInvariantIssue(context, ["types", typeIndex, "methodIds", idIndex], `Type methodIds entry must match Method owner and file: ${id}`);
      }
    });
  });

  index.methods.forEach((method, methodIndex) => {
    const file = fileByPath.get(method.filePath);
    if (!file) {
      addInvariantIssue(context, ["methods", methodIndex, "filePath"], `Method filePath must reference an existing File path: ${method.filePath}`);
    } else if (countOccurrences(file.methodIds, method.id) !== 1) {
      addInvariantIssue(context, ["methods", methodIndex, "id"], `Missing Method File membership: ${method.id}`);
    }
    const ownerType = typeById.get(method.ownerTypeId);
    if (!ownerType) addDanglingReference(context, ["methods", methodIndex, "ownerTypeId"], method.ownerTypeId);
    else {
      if (ownerType.filePath !== method.filePath) {
        addInvariantIssue(context, ["methods", methodIndex, "ownerTypeId"], `Method owner Type must share Method filePath: ${method.ownerTypeId}`);
      }
      if (countOccurrences(ownerType.methodIds, method.id) !== 1) {
        addInvariantIssue(context, ["methods", methodIndex, "ownerTypeId"], `Missing Method owner Type membership: ${method.id}`);
      }
    }
  });

  index.functions.forEach((func, functionIndex) => {
    const file = fileByPath.get(func.filePath);
    if (!file) {
      addInvariantIssue(context, ["functions", functionIndex, "filePath"], `Function filePath must reference an existing File path: ${func.filePath}`);
    } else if (countOccurrences(file.functionIds, func.id) !== 1) {
      addInvariantIssue(context, ["functions", functionIndex, "id"], `Missing Function membership in matching File: ${func.id}`);
    }
  });

  index.imports.forEach((record, importIndex) => {
    if (!fileIds.has(record.sourceFileId)) addDanglingReference(context, ["imports", importIndex, "sourceFileId"], record.sourceFileId);
    if (!fileIds.has(record.targetFileId)) addDanglingReference(context, ["imports", importIndex, "targetFileId"], record.targetFileId);
  });

  index.calls.forEach((call, callIndex) => {
    const caller = callableById.get(call.callerId);
    if (!caller) addDanglingReference(context, ["calls", callIndex, "callerId"], call.callerId);
    if (!callableById.has(call.calleeId)) addDanglingReference(context, ["calls", callIndex, "calleeId"], call.calleeId);
    if (!fileByPath.has(call.filePath)) {
      addInvariantIssue(context, ["calls", callIndex, "filePath"], `Call filePath must reference a File path: ${call.filePath}`);
    } else if (caller && caller.filePath !== call.filePath) {
      addInvariantIssue(context, ["calls", callIndex, "filePath"], `Call filePath must match caller filePath: ${call.callerId}`);
    }
  });

  index.unresolvedCalls.forEach((call, callIndex) => {
    const caller = call.callerId === null ? null : callableById.get(call.callerId);
    if (call.callerId !== null && !caller) addDanglingReference(context, ["unresolvedCalls", callIndex, "callerId"], call.callerId);
    if (!fileByPath.has(call.filePath)) {
      addInvariantIssue(context, ["unresolvedCalls", callIndex, "filePath"], `Unresolved call filePath must reference a File path: ${call.filePath}`);
    } else if (caller && caller.filePath !== call.filePath) {
      addInvariantIssue(context, ["unresolvedCalls", callIndex, "filePath"], `Unresolved call filePath must match caller filePath: ${call.callerId}`);
    }
  });
});

export const parseSymbolIndex = (value) => SymbolIndexSchema.parse(value);
