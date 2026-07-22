import { z } from "zod";
import { LineRangeSchema } from "./raw-analysis.mjs";

const GraphProjectSchema = z.object({
  name: z.string().min(1),
  languages: z.array(z.string().min(1)),
  frameworks: z.array(z.string()),
  description: z.string(),
  analyzedAt: z.string().min(1),
  gitCommitHash: z.string().min(1)
}).strict();

const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["file", "class", "function"]),
  name: z.string().min(1),
  filePath: z.string().min(1),
  lineRange: LineRangeSchema.nullable(),
  summary: z.string(),
  tags: z.array(z.string()),
  complexity: z.enum(["simple", "moderate", "complex"])
}).strict();

const GraphEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.enum(["contains", "imports", "calls"]),
  direction: z.literal("forward"),
  weight: z.number().min(0).max(1)
}).strict();

export const CodeGraphSchema = z.object({
  version: z.string().min(1),
  kind: z.literal("codebase"),
  project: GraphProjectSchema,
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  layers: z.array(z.never()).max(0),
  tour: z.array(z.never()).max(0)
}).strict().superRefine((graph, context) => {
  const nodeIds = new Set();

  graph.nodes.forEach((node, nodeIndex) => {
    if (nodeIds.has(node.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "id"], message: `Duplicate node ID: ${node.id}` });
    }
    nodeIds.add(node.id);
  });

  graph.edges.forEach((edge, edgeIndex) => {
    if (!nodeIds.has(edge.source)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", edgeIndex, "source"], message: `Unknown edge source: ${edge.source}` });
    }
    if (!nodeIds.has(edge.target)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", edgeIndex, "target"], message: `Unknown edge target: ${edge.target}` });
    }
  });
});

export const parseCodeGraph = (value) => CodeGraphSchema.parse(value);
