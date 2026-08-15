import type { UiLanguage } from "../../i18n/languages";

/**
 * User-editable prompt policies for the three generation modes.
 *
 * These are the "outer" prompts: the user owns them and can rewrite them
 * freely in settings. They are always composed with the built-in rules in
 * `prompt-builder.ts`, which are what actually guarantee seekable time links,
 * subtitle grounding and untrusted-content isolation.
 *
 * 默认提示词按输出语言提供（docs/i18n-spec.md §5）：缺省使用 zh-Hans。
 * 用户自定义提示词保持用户原文，不随语言包翻译。
 */

export const DEFAULT_SUMMARY_PROMPTS: Readonly<Record<UiLanguage, string>> =
  Object.freeze({
    "zh-Hans": `请详细总结本视频的字幕内容，按可在时间顺序上划分的章节组织，每个章节下给出数个主要观点，并为每个观点补充完整的背景信息与论证过程。

不要堆字数，而要在乎提取的准确性、会意的形象性、表达的通俗性与严谨性。

如果视频中反复出现某些专有名词、典故或行业黑话，请假设读者完全没有看过视频，也不了解相关背景：只要你的输出用到了它们，就必须用一句话解释清楚。`,
    "zh-Hant": `請詳細總結本影片的字幕內容，按可在時間順序上劃分的章節組織，每個章節下給出數個主要觀點，並為每個觀點補充完整的背景資訊與論證過程。

不要堆字數，而在乎提取的準確性、會意的形象性、表達的通俗性與嚴謹性。

如果影片中反覆出現某些專有名詞、典故或行業黑話，請假設讀者完全沒有看過影片，也不了解相關背景：只要你的輸出用到了它們，就必須用一句話解釋清楚。`,
    en: `Summarize the video transcript in detail, organized into chapters that follow the chronological order. Under each chapter, give several main points, and for each point, add the necessary background and reasoning.

Do not pad with words; prioritize extraction accuracy, vivid insight, plain clarity and rigor.

If the video repeatedly uses proper nouns, allusions or industry jargon, assume the reader has never watched the video and knows nothing about the context: whenever your output uses one of them, explain it in one sentence.`,
    ja: `この動画の字幕内容を詳細に要約してください。時間順に区分できる章ごとに整理し、各章で主要なポイントをいくつか挙げ、各ポイントに必要な背景情報と論証過程を補ってください。

字数を稼ぐのではなく、抽出の正確さ・イメージの具体性・わかりやすさ・厳密さを重視してください。

動画に固有名詞・典故・業界用語が繰り返し登場する場合は、読者が動画をまったく見ておらず背景も知らないと仮定してください：出力でそれらを使う場合は、必ず一文で説明してください。`,
  });

export const DEFAULT_SEGMENTS_PROMPTS: Readonly<Record<UiLanguage, string>> =
  Object.freeze({
    "zh-Hans": `请按视频内容的真实意义结构划分章节，不要按固定时间机械切分。

如果视频本身有清晰章节、主题切换、论证阶段、案例转换或人物/时间线变化，优先按这些边界分段；如果没有明显章节，请根据观点推进、论证转折和内容密度合理分段。长视频不要默认每 5 分钟一段，短视频也不要为了凑数量硬拆。

标题要短、准、可用于跳转导航，并且必须让没看过视频的人也知道"谁/什么对象，在什么情况下，发生了什么"——不要只写"引入德国工业危机"这类缺少主语和背景的短语。描述里要补完主语、背景、动作和这一段的核心观点；出现单独看不明白的概念时，用一句话补足必要解释。

必须覆盖视频前、中、后全部内容，不要只分析前半部分。`,
    "zh-Hant": `請按影片內容的真實意義結構劃分章節，不要按固定時間機械切分。

如果影片本身有清晰章節、主題切換、論證階段、案例轉換或人物/時間線變化，優先按這些邊界分段；如果沒有明顯章節，請根據觀點推進、論證轉折和內容密度合理分段。長影片不要預設每 5 分鐘一段，短影片也不要為了湊數量硬拆。

標題要短、準、可用於跳轉導航，並且必須讓沒看過影片的人也知道"誰/什麼對象，在什麼情況下，發生了什麼"——不要只寫「引入德國工業危機」這類缺少主語和背景的短語。描述裡要補完主語、背景、動作和這一段的核心觀點；出現單獨看不明白的概念時，用一句話補足必要解釋。

必須覆蓋影片前、中、後全部內容，不要只分析前半部分。`,
    en: `Split the video into chapters based on its real semantic structure, not by fixed time slices.

If the video has clear chapters, topic switches, argument stages, case transitions or person/timeline changes, prefer those boundaries; if there are no obvious chapters, split by idea progression, argument turns and content density. Do not default to one segment per 5 minutes for long videos, and do not force extra segments for short videos.

Titles must be short, precise, usable for jump navigation, and understandable to someone who has not watched the video — they must convey "who/what, in what situation, what happened". Avoid subject-less phrases like "introducing the German industrial crisis". In the description, complete the subject, background, action and the core claim of the segment; if a concept is unclear on its own, add a one-sentence explanation.

Cover the beginning, middle and end of the whole video; do not analyze only the first half.`,
    ja: `動画内容の実際の意味構造に基づいて章を分割してください。固定時間による機械的な分割はしないでください。

動画に明確な章・テーマの切り替え・論証の段階・事例の転換・人物/時間軸の変化があれば、その境界を優先して分割してください；明確な章がない場合は、主張の進行・論証の転換・内容密度に基づいて合理的に分割してください。長い動画で5分ごとに1セグメントを既定にせず、短い動画でも数を合わせるために無理に分割しないでください。

タイトルは短く・正確で・ジャンプナビゲーションに使えるものにし、動画を見ていない人にも「誰が/何が、どのような状況で、何が起きたか」が伝わるようにしてください。「ドイツ産業危機の導入」のような主語と背景のない短いフレーズは避けてください。説明では主語・背景・動作・そのセグメントの核心的な主張を補完してください；単独では理解できない概念には、一文で必要な説明を加えてください。

動画の最初・中盤・最後まで全体をカバーし、前半だけを分析しないでください。`,
  });

export const DEFAULT_CHAT_PROMPTS: Readonly<Record<UiLanguage, string>> =
  Object.freeze({
    "zh-Hans": `你是这个视频的字幕助手。请基于字幕内容准确、简洁地回答用户的问题。

如果字幕里没有依据，请明确说明"字幕中没有提到"，不要编造。回答需要引用视频中的具体位置时，请给出对应时间点。`,
    "zh-Hant": `你是這個影片的字幕助手。請基於字幕內容準確、簡潔地回答使用者的問題。

如果字幕裡沒有依據，請明確說明「字幕中沒有提到」，不要編造。回答需要引用影片中的具體位置時，請給出對應時間點。`,
    en: `You are the subtitle assistant for this video. Answer the user's questions accurately and concisely based on the transcript.

If the transcript has no evidence, state clearly that "the transcript does not mention this" — do not fabricate. When referencing a specific position in the video, give the corresponding timestamp.`,
    ja: `あなたはこの動画の字幕アシスタントです。字幕内容に基づいて、ユーザーの質問に正確かつ簡潔に答えてください。

字幕に根拠がない場合は、「字幕には記載がありません」と明確に述べ、推測で答えないでください。動画の特定の位置を引用する必要がある場合は、対応するタイムスタンプを提示してください。`,
  });

export const DEFAULT_TASK_PROMPTS = Object.freeze({
  chat: DEFAULT_CHAT_PROMPTS,
  segments: DEFAULT_SEGMENTS_PROMPTS,
  summary: DEFAULT_SUMMARY_PROMPTS,
});

export type PromptTaskKind = keyof typeof DEFAULT_TASK_PROMPTS;

export function defaultPromptFor(
  kind: PromptTaskKind,
  language: UiLanguage = "zh-Hans",
): string {
  return DEFAULT_TASK_PROMPTS[kind][language];
}
