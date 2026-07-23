import { z } from "zod";
import { posix } from "node:path";
import {
  CallableKindSchema,
  FactStatusSchema,
  LineRangeSchema,
  ParameterSchema,
  PropertyKindSchema,
  PropertySchema,
  TypeKindSchema,
  VisibilitySchema
} from "./raw-analysis.mjs";

const IdSchema = z.string().min(1);
const FilePathSchema = z.string().min(1).refine((value) => (
  !value.startsWith("/")
  && !/^[A-Za-z]:/.test(value)
  && !value.includes("\\")
  && !value.endsWith("/")
  && posix.normalize(value) === value
  && !value.split("/").includes(".")
  && !value.split("/").includes("..")
), "Expected a normalized project-relative file path");
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

export const SymbolIndexV1Schema = z.object({
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

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ParameterV2Schema = z.object({
  position: z.number().int().nonnegative(),
  name: z.string().min(1),
  type: z.string().min(1).nullable(),
  typeStatus: FactStatusSchema,
  defaultValue: z.string().nullable(),
  defaultStatus: FactStatusSchema,
  optional: z.boolean(),
  variadic: z.boolean()
}).strict();
const DeclarationSchema = z.object({
  filePath: FilePathSchema,
  lineRange: LineRangeSchema
}).strict();
const FileV2Schema = FileSchema.extend({
  propertyIds: z.array(IdSchema)
}).strict();
const TypeV2Schema = z.object({
  id: IdSchema,
  kind: TypeKindSchema,
  name: z.string().min(1),
  qualifiedName: z.string().min(1),
  filePath: FilePathSchema,
  lineRange: LineRangeSchema,
  declarations: z.array(DeclarationSchema).min(1),
  namespace: z.string().min(1).nullable(),
  package: z.string().min(1).nullable(),
  module: z.string().min(1).nullable(),
  visibility: VisibilitySchema,
  visibilityStatus: FactStatusSchema,
  modifiers: z.array(z.string().min(1)),
  typeParameters: z.array(z.string().min(1)),
  propertyIds: z.array(IdSchema),
  methodIds: z.array(IdSchema),
  extends: z.array(z.string().min(1)),
  implements: z.array(z.string().min(1)),
  mixins: z.array(z.string().min(1)),
  exported: z.boolean().nullable(),
  structuralFingerprint: FingerprintSchema
}).strict();
const PropertyV2Schema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: PropertyKindSchema,
  ownerTypeId: IdSchema,
  filePath: FilePathSchema,
  lineRange: LineRangeSchema.nullable(),
  type: z.string().min(1).nullable(),
  typeStatus: FactStatusSchema,
  defaultValue: z.string().nullable(),
  defaultStatus: FactStatusSchema,
  visibility: VisibilitySchema,
  visibilityStatus: FactStatusSchema,
  modifiers: z.array(z.string().min(1)),
  static: z.boolean().nullable(),
  explicitValue: z.string().nullable(),
  structuralFingerprint: FingerprintSchema
}).strict();
const CanonicalCallableFieldsV2 = {
  id: IdSchema,
  kind: CallableKindSchema,
  name: z.string().min(1),
  filePath: FilePathSchema,
  lineRange: LineRangeSchema,
  signature: z.string(),
  parameters: z.array(ParameterV2Schema),
  returnType: z.string().min(1).nullable(),
  returnTypeStatus: FactStatusSchema,
  visibility: VisibilitySchema,
  visibilityStatus: FactStatusSchema,
  modifiers: z.array(z.string().min(1)),
  typeParameters: z.array(z.string().min(1)),
  async: z.boolean().nullable(),
  exported: z.boolean().nullable(),
  structuralFingerprint: FingerprintSchema
};
const MethodV2Schema = z.object({
  ...CanonicalCallableFieldsV2,
  ownerTypeId: IdSchema,
  static: z.boolean().nullable()
}).strict();
const FunctionV2Schema = z.object(CanonicalCallableFieldsV2).strict();
const UnresolvedCallV2Schema = UnresolvedCallSchema.extend({
  candidateIds: z.array(IdSchema)
}).strict();
const TypeRelationSchema = z.object({
  id: IdSchema,
  kind: z.enum(["inherits", "implements", "mixin", "nested", "references"]),
  sourceId: IdSchema,
  targetId: IdSchema.nullable(),
  targetName: z.string().min(1),
  targetCategory: z.enum(["internal", "external", "builtin", "unresolved"]),
  origin: z.enum(["declaration", "property-type", "parameter-type", "return-type"])
}).strict();
const LanguageCapabilitySchema = z.object({
  language: z.string().min(1),
  level: z.enum(["baseline", "enriched"]),
  supportedFacts: z.array(z.string().min(1)),
  unsupportedFacts: z.array(z.string().min(1))
}).strict();

export const SymbolIndexV2Schema = z.object({
  schemaVersion: z.literal("2.0.0"),
  snapshotFingerprint: FingerprintSchema,
  project: ProjectSchema,
  files: z.array(FileV2Schema),
  types: z.array(TypeV2Schema),
  properties: z.array(PropertyV2Schema),
  methods: z.array(MethodV2Schema),
  functions: z.array(FunctionV2Schema),
  imports: z.array(ImportSchema),
  calls: z.array(CallSchema),
  unresolvedCalls: z.array(UnresolvedCallV2Schema),
  typeRelations: z.array(TypeRelationSchema),
  languageCapabilities: z.array(LanguageCapabilitySchema),
  coverage: CoverageSchema
}).strict().superRefine((index, context) => {
  const records = [
    ["files", index.files],
    ["types", index.types],
    ["properties", index.properties],
    ["methods", index.methods],
    ["functions", index.functions]
  ];
  const globalIds = new Set();
  for (const [collection, entries] of records) {
    entries.forEach((entry, entryIndex) => {
      if (globalIds.has(entry.id)) {
        addInvariantIssue(context, [collection, entryIndex, "id"], `Duplicate global ID: ${entry.id}`);
      }
      globalIds.add(entry.id);
    });
  }

  const fileByPath = new Map(index.files.map((file) => [file.path, file]));
  const typeById = new Map(index.types.map((type) => [type.id, type]));
  const propertyById = new Map(index.properties.map((property) => [property.id, property]));
  const methodById = new Map(index.methods.map((method) => [method.id, method]));
  const functionById = new Map(index.functions.map((func) => [func.id, func]));
  const callableById = new Map([...methodById, ...functionById]);
  const symbolById = new Map([...typeById, ...propertyById, ...callableById]);
  const fileIds = new Set(index.files.map((file) => file.id));
  if (fileByPath.size !== index.files.length) {
    index.files.forEach((file, fileIndex) => {
      if (index.files.findIndex((entry) => entry.path === file.path) !== fileIndex) {
        addInvariantIssue(context, ["files", fileIndex, "path"], `Duplicate File path: ${file.path}`);
      }
    });
  }

  index.files.forEach((file, fileIndex) => {
    const memberships = [
      ["typeIds", typeById],
      ["propertyIds", propertyById],
      ["methodIds", methodById],
      ["functionIds", functionById]
    ];
    for (const [field, byId] of memberships) {
      const seen = new Set();
      file[field].forEach((id, idIndex) => {
        if (seen.has(id)) addInvariantIssue(context, ["files", fileIndex, field, idIndex], `Duplicate File ${field} entry: ${id}`);
        seen.add(id);
        const record = byId.get(id);
        if (!record) addDanglingReference(context, ["files", fileIndex, field, idIndex], id);
        else if (field !== "typeIds" && record.filePath !== file.path) {
          addInvariantIssue(context, ["files", fileIndex, field, idIndex], `${field} entry must belong to matching File path: ${id}`);
        } else if (field === "typeIds" && !record.declarations.some((declaration) => declaration.filePath === file.path)) {
          addInvariantIssue(context, ["files", fileIndex, field, idIndex], `Type membership must match a declaration path: ${id}`);
        }
      });
    }
  });

  index.types.forEach((type, typeIndex) => {
    type.declarations.forEach((declaration, declarationIndex) => {
      const file = fileByPath.get(declaration.filePath);
      if (!file) addInvariantIssue(context, ["types", typeIndex, "declarations", declarationIndex, "filePath"], `Type declaration must reference a File: ${declaration.filePath}`);
      else if (!file.typeIds.includes(type.id)) addInvariantIssue(context, ["types", typeIndex, "id"], `Missing Type declaration membership: ${type.id}`);
    });
    const seenPropertyIds = new Set();
    type.propertyIds.forEach((id, idIndex) => {
      if (seenPropertyIds.has(id)) addInvariantIssue(context, ["types", typeIndex, "propertyIds", idIndex], `Duplicate Type propertyIds entry: ${id}`);
      seenPropertyIds.add(id);
      const property = propertyById.get(id);
      if (!property) addDanglingReference(context, ["types", typeIndex, "propertyIds", idIndex], id);
      else if (property.ownerTypeId !== type.id) addInvariantIssue(context, ["types", typeIndex, "propertyIds", idIndex], `Property owner mismatch: ${id}`);
    });
    const seenMethodIds = new Set();
    type.methodIds.forEach((id, idIndex) => {
      if (seenMethodIds.has(id)) addInvariantIssue(context, ["types", typeIndex, "methodIds", idIndex], `Duplicate Type methodIds entry: ${id}`);
      seenMethodIds.add(id);
      const method = methodById.get(id);
      if (!method) addDanglingReference(context, ["types", typeIndex, "methodIds", idIndex], id);
      else if (method.ownerTypeId !== type.id) addInvariantIssue(context, ["types", typeIndex, "methodIds", idIndex], `Method owner mismatch: ${id}`);
    });
  });

  index.properties.forEach((property, propertyIndex) => {
    const owner = typeById.get(property.ownerTypeId);
    if (!owner) addDanglingReference(context, ["properties", propertyIndex, "ownerTypeId"], property.ownerTypeId);
    else if (countOccurrences(owner.propertyIds, property.id) !== 1) {
      addInvariantIssue(context, ["properties", propertyIndex, "ownerTypeId"], `Missing Property owner Type membership: ${property.id}`);
    }
    const file = fileByPath.get(property.filePath);
    if (!file) addInvariantIssue(context, ["properties", propertyIndex, "filePath"], `Property filePath must reference a File: ${property.filePath}`);
    else if (countOccurrences(file.propertyIds, property.id) !== 1) {
      addInvariantIssue(context, ["properties", propertyIndex, "id"], `Missing Property File membership: ${property.id}`);
    }
  });
  index.methods.forEach((method, methodIndex) => {
    const owner = typeById.get(method.ownerTypeId);
    if (!owner) addDanglingReference(context, ["methods", methodIndex, "ownerTypeId"], method.ownerTypeId);
    else if (countOccurrences(owner.methodIds, method.id) !== 1) {
      addInvariantIssue(context, ["methods", methodIndex, "ownerTypeId"], `Missing Method owner Type membership: ${method.id}`);
    }
    const file = fileByPath.get(method.filePath);
    if (!file) addInvariantIssue(context, ["methods", methodIndex, "filePath"], `Method filePath must reference a File: ${method.filePath}`);
    else if (countOccurrences(file.methodIds, method.id) !== 1) {
      addInvariantIssue(context, ["methods", methodIndex, "id"], `Missing Method File membership: ${method.id}`);
    }
  });
  index.functions.forEach((func, functionIndex) => {
    const file = fileByPath.get(func.filePath);
    if (!file) addInvariantIssue(context, ["functions", functionIndex, "filePath"], `Function filePath must reference a File: ${func.filePath}`);
    else if (countOccurrences(file.functionIds, func.id) !== 1) {
      addInvariantIssue(context, ["functions", functionIndex, "id"], `Missing Function File membership: ${func.id}`);
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
    if (!fileByPath.has(call.filePath)) addInvariantIssue(context, ["calls", callIndex, "filePath"], `Call filePath must reference a File: ${call.filePath}`);
    else if (caller && caller.filePath !== call.filePath) addInvariantIssue(context, ["calls", callIndex, "filePath"], `Call filePath must match caller: ${call.callerId}`);
  });
  index.unresolvedCalls.forEach((call, callIndex) => {
    const caller = call.callerId === null ? null : callableById.get(call.callerId);
    if (call.callerId !== null && !caller) addDanglingReference(context, ["unresolvedCalls", callIndex, "callerId"], call.callerId);
    if (!fileByPath.has(call.filePath)) addInvariantIssue(context, ["unresolvedCalls", callIndex, "filePath"], `Unresolved call filePath must reference a File: ${call.filePath}`);
    else if (caller && caller.filePath !== call.filePath) addInvariantIssue(context, ["unresolvedCalls", callIndex, "filePath"], `Unresolved call filePath must match caller: ${call.callerId}`);
    call.candidateIds.forEach((id, idIndex) => {
      if (!callableById.has(id)) addDanglingReference(context, ["unresolvedCalls", callIndex, "candidateIds", idIndex], id);
    });
  });
  const relationIds = new Set();
  index.typeRelations.forEach((relation, relationIndex) => {
    if (relationIds.has(relation.id)) addInvariantIssue(context, ["typeRelations", relationIndex, "id"], `Duplicate relation ID: ${relation.id}`);
    relationIds.add(relation.id);
    if (!symbolById.has(relation.sourceId)) addDanglingReference(context, ["typeRelations", relationIndex, "sourceId"], relation.sourceId);
    if (relation.targetCategory === "internal" && (relation.targetId === null || !typeById.has(relation.targetId))) {
      addDanglingReference(context, ["typeRelations", relationIndex, "targetId"], relation.targetId);
    }
    if (relation.targetCategory !== "internal" && relation.targetId !== null) {
      addInvariantIssue(context, ["typeRelations", relationIndex, "targetId"], "Only internal type relations may have targetId");
    }
  });
});

export const SymbolIndexSchema = z.union([SymbolIndexV2Schema, SymbolIndexV1Schema]);
export const parseSymbolIndexV2 = (value) => SymbolIndexV2Schema.parse(value);
export const parseSymbolIndex = (value) => SymbolIndexSchema.parse(value);
