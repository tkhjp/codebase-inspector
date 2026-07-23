# Codebase Inspector

Codebase Inspector は、LLM を使わずにリポジトリの構文レベル情報を決定的に索引化し、保存済み snapshot からクラス定義書と Mermaid クラス図を生成する GitHub Copilot Skill です。

配布単位は [`.github/skills/codebase-inspector`](.github/skills/codebase-inspector) です。このディレクトリを別の Git リポジトリへコピーし、通常の shell 承認後に `/codebase-inspector analyze` または `/codebase-inspector render` を実行します。

Node.js 22 以降と Git が必要です。詳細な導入方法、解析出力、文書出力、filter、対応言語、セキュリティ境界、固定した upstream extractor の制限は Skill の [README.ja.md](.github/skills/codebase-inspector/README.ja.md) を参照してください。

`analyze` は Git が追跡しているファイルだけを解析します。既定では解析出力先だけを隠す所有ブロックを `.git/info/exclude` に追加し、`--tracked` はそのブロックを残しません。`--keep-intermediate` はレポートに記録しますが、追加ファイルは生成しません。`render` は保存済み snapshot だけを読み、ソース走査や Git 設定の変更を行いません。

本リポジトリは MIT license です。Understand-Anything の vendored extractor と依存関係の来歴は [NOTICE](NOTICE) に記録しています。
