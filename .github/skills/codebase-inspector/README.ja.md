# Codebase Inspector Skill

`codebase-inspector` は、Git リポジトリ内の構文レベルの構造を決定的に抽出する GitHub Copilot Skill です。LLM を使わず、リポジトリのファイル、クラス、メソッド、関数、import、静的に確認できる call を索引化します。

## 前提条件

- Node.js 22 以降
- Git
- 最初の依存関係取得時だけ npm registry へ接続できること

`node_modules` は配布物に含まれません。Skill ディレクトリだけを対象リポジトリの `.github/skills/codebase-inspector/` にコピーしてください。初回実行時、Skill 自身のディレクトリで `npm ci --omit=dev` が実行されます。

## 実行

Copilot では次のコマンドを使います。

```text
/codebase-inspector [project-path] [--tracked] [--output <dir>] [--keep-intermediate]
```

通常は対象リポジトリ直下に `.code-understanding/` を作成します。`project-path` を省略すると現在のディレクトリを対象にします。Copilot は対象リポジトリのルートから Skill 内部の `--skill-arguments` transport を使って引数を渡します。

引数の引用処理はコマンドを実行しません。二重引用符 token 末尾の `\"` は、バックスラッシュを保持して token を閉じます（例: `"C:\Program Files\repo\"`）。リテラルの二重引用符は、token の途中では `\"` を使います。token 末尾では `\""` を使い、最後の引用符で token を閉じます（例: `"C:\work\name\""`）。

## 出力

常に次の 6 ファイルを生成します。

- `code-graph.json`
- `symbol-index.json`
- `classes.md`
- `methods.md`
- `functions.md`
- `analysis-report.json`

JSON と Markdown は安定した順序と LF 改行で出力されます。同一の追跡対象、ignore ルール、依存関係、オプションでは、追跡モードの結果は同一バイトになります。

## ファイル選択

両方のモードで Git が追跡しているファイルだけを解析します。既定モードは、出力先だけを隠す Codebase Inspector 所有ブロックを `.git/info/exclude` に追加し、追跡済みの `.gitignore` は変更しません。`--tracked` はこの所有ブロックを削除し、残さないため、生成した出力を version control に含められます。`--output <dir>` は対象リポジトリ内の出力先を指定します。`--keep-intermediate` は受け付けてレポートに記録しますが、追加ファイルは生成しません。

## 対応言語

JavaScript、TypeScript、Python、Rust、Go、Java、Kotlin、C#、C、C++、PHP、Ruby、Dart に対応します。Shell はこのリリースでは未対応です。構文網羅性は、固定された Understand-Anything extractor snapshot の制限に従います。

## セキュリティ境界

分析は LLM、AI API、MCP server、language server を呼びません。対象リポジトリの build、test、package script、Makefile、実行形式も起動しません。依存関係の導入後は、外向きネットワーク接続が遮断された環境でも分析できます。出力には名前、行範囲、宣言、型テキスト、import、call target などの構文情報が含まれることがあります。

## `/understand` との違い

`code-graph.json` は Understand-Anything 系ツールで有用な外側の graph 形状を保ちますが、LLM を使う `/understand` と意味的に同等ではありません。この Skill は構文レベルの事実のみを出力し、業務理解、設計意図、役割推論、自然言語のアーキテクチャ説明、動的 dispatch の推測は行いません。
