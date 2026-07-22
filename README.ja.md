# Codebase Inspector

Codebase Inspector は、LLM を使わずにリポジトリの構文レベル情報を決定的に索引化する GitHub Copilot Skill です。

配布単位は [`.github/skills/codebase-inspector`](.github/skills/codebase-inspector) です。このディレクトリを別の Git リポジトリへコピーし、通常の shell 承認後に `/codebase-inspector [project-path] [--tracked] [--output <dir>] [--keep-intermediate]` を実行します。

Node.js 22 以降と Git が必要です。詳細な導入方法、6 個の出力、対応言語、セキュリティ境界、固定した upstream extractor の制限は Skill の [README.ja.md](.github/skills/codebase-inspector/README.ja.md) を参照してください。

本リポジトリは MIT license です。Understand-Anything の vendored extractor と依存関係の来歴は [NOTICE](NOTICE) に記録しています。
