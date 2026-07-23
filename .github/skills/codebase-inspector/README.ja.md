# Codebase Inspector Skill

`codebase-inspector` は、Git リポジトリ内の構文レベルの構造を決定的に抽出する GitHub Copilot Skill です。LLM を使わず、ファイル、型、属性、メソッド、関数、import、静的に確認できる call と型関係を索引化します。保存済み snapshot から、条件を変えて `クラス定義書.md` と `クラス図.md` を再生成できます。

## インストール

対象リポジトリのルートで、次の ZIP の**どちらか一方だけ**を展開してください。両方を同じ場所へ重ねて展開しないでください。どちらの ZIP も `.github/skills/codebase-inspector/` を作成します。

- `codebase-inspector-0.2.0.zip`: 軽量版です。初回実行時に production dependencies を取得するため、npm registry への接続が必要です。
- `codebase-inspector-0.2.0-with-dependencies.zip`: production dependencies を含むためサイズは大きくなりますが、依存関係をダウンロードせずに実行できます。

## 前提条件

- Node.js 22 以降
- Git
- 軽量版を初めて実行する場合だけ、npm registry へ接続できること

軽量版では、初回実行時に Skill 自身のディレクトリで `npm ci --omit=dev` が実行されます。

## 解析

Copilot では次のコマンドを使います。

```text
/codebase-inspector analyze [project-path] [--tracked] [--output <dir>] [--keep-intermediate]
```

`analyze` は省略できます。通常は対象リポジトリ直下に `.code-understanding/` を作成します。`project-path` を省略すると現在のディレクトリを対象にします。Copilot は対象リポジトリのルートから Skill 内部の `--skill-arguments` transport を使って引数を渡します。

引数の引用処理はコマンドを実行しません。二重引用符 token 末尾の `\"` は、バックスラッシュを保持して token を閉じます（例: `"C:\Program Files\repo\"`）。リテラルの二重引用符は、token の途中では `\"` を使います。token 末尾では `\""` を使い、最後の引用符で token を閉じます（例: `"C:\work\name\""`）。同じ token 内でリテラルの二重引用符の直後に空白を置く場合は、token 全体を一重引用符で囲む必要があります（例: `'C:\Program Files\name" next'`）。

## 出力

常に次の 6 ファイルを生成します。

- `code-graph.json`
- `symbol-index.json`
- `classes.md`
- `methods.md`
- `functions.md`
- `analysis-report.json`

JSON と Markdown は安定した順序と LF 改行で出力されます。同一の追跡対象、ignore ルール、依存関係、オプションでは、追跡モードの結果は同一バイトになります。

`symbol-index.json` schema `2.0.0` が権威データです。型、属性、メソッド、関数はそれぞれ安定 ID と構造 fingerprint を持ちます。取得できない値は、`not-declared`、`unsupported`、`failed` を区別します。`code-graph.json` は Understand-Anything 系 consumer 向けの compatibility projection です。

## クラス文書の生成

解析済み snapshot を再利用します。ソースの再解析は行いません。

```text
/codebase-inspector render \
  --snapshot .code-understanding/symbol-index.json \
  --path src/orders \
  --language typescript \
  --visibility public \
  --max-types 100 \
  --split-size 50 \
  --split-by namespace \
  --output .code-understanding/structure-docs
```

主な条件：

| Option | 内容 |
|---|---|
| `--snapshot <file>` | `symbol-index.json`。既定は `.code-understanding/symbol-index.json` |
| `--path <prefix>` | PJ 相対 path prefix |
| `--language <name>` | 言語 |
| `--type-kind <kind>` | class、interface、struct、enum、trait、record、module |
| `--visibility <value>` | public、protected、private、internal、package |
| `--name <text>` | 型名の部分一致 |
| `--include-non-public` | 非公開・可視性未確定の型と member を含める |
| `--omit-diagram-members` | クラス図から属性・メソッドを省略 |
| `--max-types <count>` | 全体上限。既定 100 |
| `--split-size <count>` | 1 ファイル当たりの型上限。既定 50 |
| `--split-by <value>` | none、language、module、package、namespace、path |
| `--definition-output <name>` | 定義書 filename |
| `--diagram-output <name>` | クラス図 filename |
| `--output <dir>` | 3 種類の文書出力先 |

生成物：

- `クラス定義書.md`
- `クラス図.md`
- `structure-render-report.json`

大規模な選択は自動的に分割され、上記 2 ファイルは分割成果物への索引になります。定義書と図は同じ type ID 集合から生成されます。
`structure-render-report.json` には指定条件、出力先、対象・省略型件数、parser warning / 未対応 file、未解決・省略関係件数、選択された表示対象メソッドの call 解決件数を PJ 相対 path で記録します。CLI の完了行にも主要件数と 3 つの出力先を返します。

## ファイル選択

`analyze` は Git が追跡しているファイルだけを解析します。既定モードは、解析出力先だけを隠す Codebase Inspector 所有ブロックを `.git/info/exclude` に追加し、追跡済みの `.gitignore` は変更しません。`--tracked` はこの所有ブロックを削除し、残さないため、解析出力を version control に含められます。`--keep-intermediate` は受け付けてレポートに記録しますが、追加ファイルは生成しません。

`render` は指定した snapshot だけを読み、ソースファイルの走査や `.git/info/exclude` の変更を行いません。文書出力を version control に含めるかどうかは、対象リポジトリ側で管理します。

## 対応言語

JavaScript、TypeScript、Python、Rust、Go、Java、Kotlin、C#、C、C++、PHP、Ruby、Dart に対応します。Shell はこのリリースでは未対応です。構文網羅性は、固定された Understand-Anything extractor snapshot の制限に従います。

| 言語 | 詳細度 | 保持する主な情報 |
|---|---|---|
| JavaScript、TypeScript | enriched | type kind、generic、constructor、getter/setter、属性型、引数、戻り値、可視性、修飾子、継承・実装、enum value |
| Python、Rust、Go、Java、Kotlin、C#、C/C++、PHP、Ruby、Dart | baseline | upstream の型・メソッド・関数・import・call に、AST で確認できた type kind と所属名を追加 |

言語ごとの `supportedFacts` と `unsupportedFacts` は `symbol-index.json` と `analysis-report.json` に保存されます。未対応情報を名前から推測しません。

## セキュリティ境界

分析は LLM、AI API、MCP server、language server を呼びません。対象リポジトリの build、test、package script、Makefile、実行形式も起動しません。依存関係の導入後は、外向きネットワーク接続が遮断された環境でも分析できます。出力には名前、行範囲、宣言、型テキスト、default 式、import、call target などの構文情報が含まれることがあります。

## Schema 更新

`0.2.0` の renderer は `symbol-index.json` schema `2.0.0` だけを受け付けます。`1.0.0` snapshot は暗黙に移行せず、`/codebase-inspector analyze` の再実行を要求します。

## `/understand` との違い

`code-graph.json` は Understand-Anything 系ツールで有用な外側の graph 形状を保ちますが、LLM を使う `/understand` と意味的に同等ではありません。この Skill は構文レベルの事実のみを出力し、業務理解、設計意図、役割推論、自然言語のアーキテクチャ説明、動的 dispatch の推測は行いません。
