import { fileURLToPath, URL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createParserRegistry } from "../../lib/parsers/registry.mjs";

const skillDir = fileURLToPath(new URL("../..", import.meta.url));
let registry;

beforeAll(async () => {
  registry = await createParserRegistry(skillDir);
});

afterAll(async () => {
  await registry.close();
});

test("preserves rich TypeScript declaration facts without semantic inference", async () => {
  const result = await registry.analyzeFile({
    path: "src/order.ts",
    language: "typescript",
    content: [
      "import { fetch as load } from './gateway';",
      "export interface Identifiable<T> { id: T; find(value?: T): Promise<T>; }",
      "export enum Status { Pending = 'pending', Complete = 'complete' }",
      "export class Order<T> implements Identifiable<T> {",
      "  public readonly id: T;",
      "  private _status: Status = Status.Pending;",
      "  #secret: string = 'hidden';",
      "  constructor(id: T) { this.id = id; }",
      "  public get status(): Status { return this._status; }",
      "  public set status(value: Status) { this._status = value; }",
      "  public async find(value: T = this.id): Promise<T> { return value; }",
      "}",
      "export const run = (id: string): string => load(id);"
    ].join("\n")
  });

  expect(result.capabilityLevel).toBe("enriched");
  expect(result.warnings).toEqual([]);
  expect(result.importCandidates).toEqual([
    expect.objectContaining({ source: "./gateway", specifiers: ["fetch as load"] })
  ]);
  expect(result.functions).toEqual([
    expect.objectContaining({
      name: "run",
      exported: true,
      parameters: [expect.objectContaining({ name: "id", type: "string" })],
      returnType: "string"
    })
  ]);
  expect(result.callCandidates).toEqual([
    expect.objectContaining({
      callerName: "run",
      callerOwnerName: null,
      calleeText: "load",
      argumentCount: 1
    })
  ]);
  expect(result.types.map((type) => [type.kind, type.name])).toEqual([
    ["interface", "Identifiable"],
    ["enum", "Status"],
    ["class", "Order"]
  ]);
  expect(result.types.find((type) => type.name === "Order")).toEqual(expect.objectContaining({
    implements: ["Identifiable<T>"],
    typeParameters: ["T"],
    properties: expect.arrayContaining([
      expect.objectContaining({ name: "id", kind: "field", type: "T", visibility: "public" }),
      expect.objectContaining({ name: "_status", type: "Status", defaultValue: "Status.Pending", visibility: "private" }),
      expect.objectContaining({ name: "#secret", type: "string", visibility: "private" })
    ])
  }));
  expect(result.types.find((type) => type.name === "Status").properties).toEqual([
    expect.objectContaining({ name: "Pending", kind: "enum-member", explicitValue: "'pending'" }),
    expect.objectContaining({ name: "Complete", kind: "enum-member", explicitValue: "'complete'" })
  ]);
  expect(result.methods).toEqual(expect.arrayContaining([
    expect.objectContaining({ ownerName: "Order", kind: "constructor", name: "constructor" }),
    expect.objectContaining({ ownerName: "Order", kind: "getter", name: "status", returnType: "Status" }),
    expect.objectContaining({ ownerName: "Order", kind: "setter", name: "status" }),
    expect.objectContaining({
      ownerName: "Order",
      kind: "method",
      name: "find",
      returnType: "Promise<T>",
      parameters: [expect.objectContaining({ position: 0, name: "value", type: "T", defaultValue: "this.id" })]
    })
  ]));
});
