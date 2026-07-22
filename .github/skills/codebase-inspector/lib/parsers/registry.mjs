import { createTreeSitterRuntime, GRAMMAR_CONFIGS } from "./tree-sitter-runtime.mjs";

const javascriptExtractor = {
  extract(rootNode, context) {
    const functions = [];
    for (const node of rootNode.namedChildren) {
      if (node.type !== "function_declaration") continue;
      const name = node.childForFieldName("name");
      if (!name) continue;
      functions.push({
        name: name.text,
        lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
        parameters: [],
        returnType: null,
        visibility: null,
        async: null,
        exported: null
      });
    }

    return {
      filePath: context.filePath,
      language: context.language,
      types: [],
      methods: [],
      functions,
      importCandidates: [],
      callCandidates: [],
      warnings: []
    };
  }
};

export async function createParserRegistry(skillDir) {
  const extractors = new Map([["javascript", javascriptExtractor]]);
  const runtime = await createTreeSitterRuntime(skillDir, extractors);

  return {
    languages: Object.freeze([...Object.keys(GRAMMAR_CONFIGS), "shell"]),
    analyzeFile: runtime.analyzeFile,
    close: runtime.close
  };
}
