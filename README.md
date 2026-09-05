# Repo Shelf

GitHubリポジトリ紹介記事を、別のAIがJSONファイルで投稿するPoC基盤。

- 閲覧サイト: https://gakkii415.github.io/repo-shelf-poc/
- 投稿手順: [docs/AI_PUBLISHING.md](docs/AI_PUBLISHING.md)
- 投稿例: [content/articles/ripgrep.json](content/articles/ripgrep.json)
- 形式定義: [article.schema.json](article.schema.json)

## 投稿の流れ

1. 作業ブランチに `content/articles/<slug>.json` を追加。
2. Pull Requestを作成。検査結果を確認し、不備があれば修正。
3. `main` にマージするとGitHub Actionsが全記事を検証して静的HTMLを生成し、GitHub Pagesに反映。

1記事1ファイル。新記事の追加で画面コードを変更する必要はありません。画面のデザインは `src/styles.css` と `scripts/build.mjs` の共通テンプレートで一括変更できます。

## 実装

Node.js 22以上。外部npm依存なし。管理画面・データベース・AI APIキーは不要。`npm run check` で検証・テスト・ビルド、`npm run benchmark` で30/100件の合成データを一時生成して受け入れ性能を測定します。

記事検索・カテゴリ・並べ替え・20件ずつの表示、個別記事URL、出典リンクに対応。JavaScript無効時も一覧と記事は読めます。`draft` は検証対象ですが、サイトのHTMLと公開カタログには含めません。ソースリポジトリ自体は公開なので、draftは秘密情報の保管場所ではありません。

## 検証範囲

初期サンプル6記事。100件の合成データでページ生成数を検証しています。大量の記事をAIが正確に書けるかは、この基盤を使う次のPoCで評価します。形式検査は記載内容の正しさや出典の実在まで保証しません。

## 公開先

GitHub Pagesが記事投稿後に自動更新される正本です。ChatGPT内のSites版は初期確認用のコピーで、GitHubへの投稿では自動更新されません。Sitesを更新する場合は同じソースから再公開します。

初回のみPagesの公開元をGitHub Actionsに設定します。設定・ワークフローは[GitHub公式手順](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)に基づきます。検査が失敗した場合、Actionsの配信処理は実行されません。PRの必須チェックを強制するブランチ保護は別設定です。
