# Bilimuzhi 🎬✨

> 🌐 **言語 / Language**:[中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md)

<p align="center">
  <img src="assets/bilimuzhi-banner.jpg" alt="Bilimuzhi" width="100%" />
</p>

<p align="center">
  <span style="display:inline-block;padding:3px 12px;border-radius:999px;background:#6e7781;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px;">BILIBILI</span>
  <span style="display:inline-block;padding:3px 12px;border-radius:999px;background:#0969da;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px;">AI SUBTITLES</span>
  <span style="display:inline-block;padding:3px 12px;border-radius:999px;background:#6e7781;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px;">CHROMIUM MV3</span>
  <span style="display:inline-block;padding:3px 12px;border-radius:999px;background:#24292f;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px;">LOCAL FIRST</span>
  <span style="display:inline-block;padding:3px 0 3px 12px;border-radius:999px 0 0 999px;background:#57606a;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px 0;">LICENSE</span><span style="display:inline-block;padding:3px 12px 3px 6px;border-radius:0 999px 999px 0;background:#bf3989;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;margin:2px;">MIT</span>
</p>

---

**プロジェクト概要**:Bilimuzhiは、完全ローカル優先の Bilibili 動画 AI 字幕ワークベンチブラウザ拡張機能です。「動画を本当に理解する」ことを目的に設計されています。任意の B 站動画ページを開けば、公式/AI/多言語字幕トラックを取得できるほか、字幕のない動画には音声文字起こしで字幕を生成できます。その後、AI がワンクリックでコンテンツ把握を支援します——セグメント分割(広告セグメントの自動認識付き)、3 段階の要約(簡潔/バランス/詳細。本文にクリック可能なタイムスタンプを埋め込み)、現在のタイムスタンプ付き画像にも対応する多ターンチャット。バッチモードは 6 種類のソース(単一動画・ユーザーホーム・お気に入り・コレクション・分割パート・検索ページ)から字幕を一括取得または一括音声文字起こしし、TXT/SRT/Markdown/ZIP で一括エクスポートしてナレッジベースを構築できます。セッション/バッチ両モードにはそれぞれ独立したアーカイブ(タグ・ピン留め・ドラッグ並べ替え)とゴミ箱(7/30/365 日・カスタム・無期限の自動クリーンアップ)があり、パスワード暗号化バックアップでセッション・字幕・AI 成果物を長期間保存できます。プライバシー最優先:テレメトリなし・クラウドアカウントなし。API Key はローカルにのみ保存され、AI チャットは選択したプロバイダーへ直接接続します。字幕と Cookie の処理はすべてローカルブラウザで完結。Chromium ベースのブラウザ(MV3)で動作し、UI は简体中文 / 繁體中文 / English / 日本語 に対応しています。

**主な特徴**:

- 🎙️ **字幕取得 + 音声文字起こし**:公式/AI/多言語トラック対応。字幕のない動画もワンクリックで字幕生成;
- 🧠 **AI セグメント / 要約 / チャット**:章立て見出し+概要、3 段階要約、画像チャット、すべてクリック可能なタイムスタンプ付き;
- 📦 **バッチ処理**:6 種類のソース(動画/分割パート/コレクション/お気に入り/ホーム/検索)から一括取得・一括エクスポート(TXT/SRT/Markdown/ZIP)でナレッジベースを構築;
- 🔒 **プライバシー最優先**:テレメトリなし・クラウドアカウントなし。API Key はローカルブラウザにのみ保存。

## 🔥 機能ハイライト

### 特大ハイライト

- 🔥 **セッションモード + バッチモードの二刀流**:それぞれ独立したワークスペース・アーカイブ・ゴミ箱を備え、互いに干渉しません。
- ⏱️ **タイムライン モード**:仮想化字幕タイムライン。任意の字幕行をクリックするとプレイヤーが対応時刻にジャンプ。「同期モード」で現在の字幕をプレイヤーに追従させて中央ハイライトできます。
- 📑 **セグメント モード**:AI が動画を複数の段落に自動分割し、各段落に見出しと概要を付与。段落クリックで対応時刻にジャンプ。広告セグメントは自動認識されます。
- 📝 **要約 3 段階**:簡潔 / バランス / 詳細から選択可能。要約テキストには**時間リンク**が埋め込まれ、クリックで動画の該当時刻にジャンプします。

### 大ハイライト

- 💬 **多ターン AI チャット**:1 動画につき複数の会話スレッドを作成可能。会話中に**現在の動画タイムスタンプ付きの画像**を送信できます。会話出力内の時間ボタンもプレイヤーへジャンプします。
- 📦 **バッチ モード**:6 種類のソース(単一動画・ユーザーホーム・お気に入り・コレクション・分割パート・検索ページ)から字幕を一括取得、または一括音声文字起こし。**複数バッチリスト**対応。TXT/SRT/Markdown/ZIP 一括エクスポート。
- 🎙️ **音声文字起こし**:Groq 無料枠に対応。FFmpeg WASM によるローカル分割処理。**クロスモード**で奇数/偶数チャンク間の 2 モデルを交互に使い、クォータ分散とレート制限回避を実現。中国語・英語・その他・混合の 4 言語モード。

### その他のハイライト

- 🗂️ **アーカイブ + タグシステム**:セッションモードのアーカイブはタグ対応(上限 200 個、名称 20 字以内)、ピン留めとドラッグ並べ替え対応。バッチモードにも独立したアーカイブがあります。
- 🗑️ **ゴミ箱 + 自動削除期限**:両モードにゴミ箱があり、7 日 / 30 日 / 365 日 / カスタム / 無期限から選択。期限到達で自動クリーンアップ。
- 💾 **バックアップと長期保存**:パスワード暗号化によるエクスポート/インポート。セッション・字幕・AI 成果物を長期保存し、復元も完全に再現。
- 🌐 **多数の AI プロバイダー**:OpenAI、OpenRouter、DeepSeek、Gemini、Groq、Claude、智譜、ModelScope、Kimi、MiMo およびカスタム Provider。プロバイダーごとに独立した API Key。
- 🎨 **美しい UI**:ライト / ダーク / システム追従テーマ、固定ブルーアクセント、ドラッグ可能な 2 ペイン。UI 言語は简体中文 / 繁體中文 / English / 日本語。

### ⏱️ タイムスタンプジャンプ機能

Bilimuzhi は**要約モード**と**チャットモード**の本文に**クリック可能なタイムスタンプ**を埋め込めます。動作は次のとおりです:

- **現在のページが該当動画の場合**:タイムスタンプクリックでその位置に直接ジャンプ;
- **該当動画タブが開いているがアクティブでない場合**:そのタブへ自動で切り替えて該当位置にジャンプ;
- **該当動画タブが開いていない場合**:動画を開くか確認し、確認後に開いて該当位置へジャンプ。

**主な特徴**:

- 🎙️ **字幕取得 + 音声文字起こし**:公式/AI/多言語トラック対応。字幕のない動画もワンクリックで字幕生成;
- 🧠 **AI セグメント / 要約 / チャット**:章立て見出し+概要、3 段階要約、画像チャット、すべてクリック可能なタイムスタンプ付き;
- 📦 **バッチ処理**:6 種類のソース(動画/分割パート/コレクション/お気に入り/ホーム/検索)から一括取得・一括エクスポート(TXT/SRT/Markdown/ZIP)でナレッジベースを構築;
- 🔒 **プライバシー最優先**:テレメトリなし・クラウドアカウントなし。API Key はローカルブラウザにのみ保存。

## 🎯 こんな方におすすめ

- 動画を全部見る時間がないが、**大意だけ把握したい**;
- **映像がほぼ重要でない**動画(ポッドキャスト・ブログ・口述系)は、音声/テキストだけで十分;
- 動画の**目次索引**を作り、特定の部分にすぐアクセスしたい;
- **AI ナレッジベース**を整理したい:字幕のアーカイブ・タグ・検索・エクスポート。

## 🚀 代表的なワークフロー

1. **動画を開く → 字幕を取得**:任意の B 站動画ページを開く → Bilimuzhiを開く →「動画内蔵字幕を取得」(公式/AI/多言語トラック)または「音声文字起こし」(字幕なし動画)。
2. **AI で素早く理解**:ワンクリックセグメント(各段落に見出し+概要)→ ワンクリック要約(簡潔/バランス/詳細)→ 要約・セグメント内の時間リンクをクリックして動画の該当箇所へ。
3. **多ターンで掘り下げ**:理解できない箇所について会話を開始。画像 + 現在のタイムスタンプを送って、映像コンテキスト込みで AI に回答させます。会話出力内の時間ボタンで直接ジャンプ。
4. **長期保存**:視聴後にアーカイブ + タグ付け + ゴミ箱期限設定。パスワード暗号化バックアップでいつでも復元。
5. **バッチ処理**:複数動画(ホーム/お気に入り/コレクション/分割パート/検索ページ)を一括取得または一括音声文字起こし。TXT/SRT/Markdown/ZIP で一括エクスポートし資料庫を構築。

## 🛠️ インストールとクイックスタート

**前提条件**:Chromium ベースのブラウザ(Chrome、Edge、Brave、Vivaldi、Opera など。MV3、Chromium 114 以降)。

```bash
npm ci
npm run build
```

1. ブラウザの拡張機能管理ページを開く(Chrome 系は `chrome://extensions`、Edge は `edge://extensions`、他の Chromium ベースブラウザも同様の入口);
2. 「デベロッパーモード」をオンにする;
3. 「パッケージ化されていない拡張機能を読み込む」をクリックし、`dist/extension` ディレクトリを選択。

**初回利用**:任意の B 站動画ページを開く → 拡張機能アイコンをクリックしてBilimuzhiを開く →「動画内蔵字幕を取得」または「音声文字起こし」。

> 💡 ソースからビルドしたくない場合は、[GitHub Releases](https://github.com/StaySound4/bilimuzhi/releases) からパッケージ版 ZIP をダウンロードして解凍し、デベロッパーモードで読み込むこともできます。

**API Key 設定**:設定画面で入力(ブラウザローカルにのみ保存)。

## 🔒 セキュリティとプライバシーの約束

- **テレメトリなし・統計なし・クラウドアカウントなし**;
- **API Key はブラウザのローカルストレージにのみ保存**。公開 UI には「設定済みかどうか」だけ表示;
- **AI チャットはユーザーが Key を設定した後、選択したプロバイダーへ直接接続**;
- **ログイン・有料・DRM・地域制限を回避しません。チャージ動画の字幕取得は非対応**;
- **字幕と Cookie の処理はすべてローカルブラウザで完結**。詳細は [プライバシーポリシー(中文)](PRIVACY.zh-CN.md) / [Privacy Policy (English)](PRIVACY.en.md) と [リスク告知](RISKS.md) をご覧ください。

## ⚠️ 既知の制限

- Bilibili のみ対応。**Chromium ベースのブラウザの MV3 Side Panel のみ**(Firefox/Safari など非 Chromium エンジンは非対応);
- **チャージ動画/有料コンテンツの字幕取得は非対応**;
- ページ内 fetch/XHR 字幕キャプチャは未完了(現在は公式字幕 API 経由);
- 音声文字起こしは Groq 無料枠依存のためレート制限あり;
- バッチソースは B 站 API 変更時に動作しなくなる可能性あり;
- 設計目標は 10,000 行字幕・500 メッセージ規模。その規模の自動性能ゲートは未完成で、極端な規模の負荷テストは未実施。

## 📸 スクリーンショット

### セッションと字幕取得

| スクリーンショット | 説明 |
|---|---|
| ![セッション管理](assets/screenshots/session-management.png) | セッション管理:新規作成/検索/アーカイブ。BV 番号または完全 URL で動画セッションを開く |
| ![字幕取得](assets/screenshots/timeline-acquire-subtitle.png) | タイムラインモード:動画内蔵字幕と音声文字起こしの 2 つの取得方法 |
| ![セグメントとタイムライン](assets/screenshots/segments-timeline.png) | セグメント結果(見出し+概要+タイムスタンプ)と字幕タイムラインの 2 画面 |

### AI 機能

| スクリーンショット | 説明 |
|---|---|
| ![要約とタイムスタンプジャンプ](assets/screenshots/timestamp-jump.png) | 要約内のクリック可能なタイムスタンプ。クリックでプレイヤーが該当位置にジャンプ |
| ![ライト/ダークテーマ](assets/screenshots/theme-light-dark-summary.png) | ライト/ダークテーマ比較:要約出力とタイムスタンプのスタイル |
| ![出力レイアウトカスタマイズ](assets/screenshots/output-layout-customization.png) | 各モードの出力レイアウトとモデル設定(プロバイダー/モデル/推論強度/出力言語)の高度なカスタマイズ |
| ![チャットモード](assets/screenshots/chat-image-timestamps.png) | 多ターン AI チャット:画像添付(現在のタイムスタンプ付き)、返信にジャンプ可能な時間インデックス |
| ![広告認識](assets/screenshots/segments-ad-recognition.png) | セグメントモードが広告セグメントを自動認識 |

### バッチモード

| スクリーンショット | 説明 |
|---|---|
| ![バッチ解析](assets/screenshots/batch-parse-dialog.png) | 6 種類のソース解析:単一動画・分割パート・ユーザーホーム・お気に入り・コレクション・検索 |
| ![バッチリスト](assets/screenshots/batch-list-success.png) | バッチリスト:40 本の動画をリストに追加、行ごとに状態を表示 |
| ![バッチ取得中](assets/screenshots/batch-acquire-progress.png) | バッチ取得/音声文字起こしの進行中:ステータス列のスピナーとリアルタイム進捗 |
| ![エクスポート](assets/screenshots/batch-export-format.png) | 一括エクスポート:TXT / SRT / Markdown、ZIP パッケージ対応 |

### その他

| スクリーンショット | 説明 |
|---|---|
| ![多言語](assets/screenshots/settings-language.png) | UI 言語:简体中文 / 繁體中文 / English / 日本語 |

## 💖 プロジェクトを支援してください

Bilimuzhiが役に立つと思ったら、ぜひ:

- ⭐ **GitHub で Star を付けてください** — あなたの 1 つの星が、私が深夜にコードを書く一番の励みになります;
- 💬 使いにくい点・バグ発見・改善アイデアは [Issues](https://github.com/StaySound4/bilimuzhi/issues) へ — 専門的な表現でなくても大丈夫。起きたこと・期待したこと・望むことを書いていただければ、すべて真剣に読みます;
- 🤝 コードが書ける方は **PR** も歓迎です — Issue より数ステップ厳しめです:全ゲート(`npm run check:full`)を通過し、新機能にはテストが必須、コミットメッセージは形式に従います。詳細は [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。

> 本プロジェクトは作者が余暇にメンテナンスしています。返信が遅くなることもありますが、すべての Issue と PR には必ず目を通します。

## 📚 ドキュメント索引

- [プライバシーポリシー(中文)](PRIVACY.zh-CN.md) / [Privacy Policy (English)](PRIVACY.en.md)
- [リスク告知書](RISKS.md)
- [技術実装説明](TECHNICAL.zh-CN.md)(中文)
- [コントリビューションガイド](CONTRIBUTING.md)
- [行動規範](CODE_OF_CONDUCT.md)
- [セキュリティポリシー](SECURITY.md)
- [免責事項](DISCLAIMER.md)
- [更新履歴](CHANGELOG.md)

## 🎁 謝辞とインスピレーションの出典

Bilimuzhi は**完全に独立して開発された**プロジェクトです:コード・アーキテクチャ・文章はすべてプロジェクト自身が独自に設計・実装したものです。開発過程では、コミュニティの優れた類似製品がインタラクションの形についての考え方に刺激を与えてくれました。ここに謝意を表します:

### SubBatch — B 站字幕一括ダウンロードツール

字幕一括取得ワークフローに関するコミュニティへの刺激に感謝します。

- GitHub ディスカッション(掲載元):<https://github.com/ruanyf/weekly/issues/8776>
- Chrome Web Store:<https://chromewebstore.google.com/detail/subbatch-b%E7%AB%99%E5%AD%97%E5%B9%95%E6%89%B9%E9%87%8F%E4%B8%8B%E8%BD%BD%E5%B7%A5%E5%85%B7/khokmgnfhchkclncfkeccepcamdannoj>
- 開発者 GitHub:itchaox
- Bilibili ホームページ:<https://space.bilibili.com/521041866>

### Bilitato — B 站動画視聴の AI コンパニオン

AI 寄り添い視聴・音声文字起こし・タイムスタンプジャンプのインタラクション形態における探求に感謝します。

- Chrome Web Store:<https://chromewebstore.google.com/detail/bilitato-ai%E9%99%AA%E4%BD%A0%E7%9C%8Bb%E7%AB%99/ggddcgdafeeoijoaohcffinbefcbpcga>
- GitHub リポジトリ:<https://github.com/erikzhuang55/Bilitato>
- 開発者 GitHub:erikzhuang55

### AI パートナーへの特別な感謝

最後に、**OpenAI ChatGPT** と **DeepSeek** の無私の貢献に特別な感謝を:彼らは「このエラーはどういう意味?」から「ここをリファクタリングして」まで、24時間対応のホットライン並みの忍耐で付き合ってくれ、一度も「自分でやれば?」とは言いませんでした。彼らのおかげで、コード経験が浅い私でも vibe coding でこのプロジェクトを形にできました。コードスタイルに『妙な味』を感じたら、それはきっと彼らの深夜残業の痕跡です。


> **独立性の声明**:Bilimuzhi のコード・文章・アーキテクチャはすべて**独立して設計・実装**されたものです。いかなる第三者のコード・資産・素材・プライベートインターフェースも含まず、いかなる第三者プロジェクトとのコードレベルの関連性もありません。著作権に関して疑問があれば、Issue からご連絡ください。

## 📜 オープンソースライセンス

本プロジェクトは **MIT License** で公開されています。詳細は [LICENSE](LICENSE) をご覧ください。著作権表示と許諾表示を保持する限り、商用利用を含め自由に使用・変更・再配布できます。本プロジェクトは「現状のまま(AS IS)」提供され、いかなる保証もありません。
