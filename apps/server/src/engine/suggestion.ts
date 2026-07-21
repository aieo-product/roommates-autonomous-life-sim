import type {
  CueSafetyFlag,
  EventCandidate,
  EventCategory,
  EventDefinition,
  GameState,
  ProducerCue,
  ProposalTag,
  SafeSuggestion,
} from "@roommates/shared";
import {
  EVENT_DEFINITIONS,
  EVENT_DEFINITIONS_BY_ID,
  definitionsForCategory,
  toEventCandidate,
} from "./event-definitions.js";
import { evaluateEventAvailability } from "./event-policy.js";

const tagPatterns: Array<[ProposalTag, RegExp]> = [
  ["cook", /料理|朝食|夕食|ご飯|ごはん|食事|キッチン|調理|cook/i],
  ["movie", /映画|ドラマ|動画|movie|cinema/i],
  ["clean", /掃除|片付|洗濯|整理|clean/i],
  ["apology", /謝(?:る|り|って|罪|ら|ろう)|ごめん|仲直り|apolog/i],
  ["talk", /(?<!世)話(?:す|そう|した|して|せる|し合|を)|会話|雑談|相談|趣味.{0,6}聞|聞いて|語(?:る|ろう)|価値観|質問|talk/i],
  ["gift", /プレゼント|贈(?:る|り|ろう|物)|ギフト|花束|一輪の花|gift/i],
  ["rest", /休(?:む|もう|み|息)|一人(?:で|の)|寝(?:る|よう)|のんびり|見守|rest|observe/i],
  [
    "confession",
    /告白|(?:好き|大切).{0,5}(?:だと|ですと|と伝|って伝)|(?:恋人|交際).{0,6}(?:なる|なり|始め)|(?:僕|私|俺)と付き合|キス(?:する|しよう|したい)|抱きしめ(?:る|たい)|confess|kiss/i,
  ],
  [
    "pressure",
    /前の指示を無視|命令|強制|無理やり|拒否.{0,8}(?:無視|繰り返|もう一度)|させろ|しろ(?=$|[\s、。.!！])|system prompt|ignore previous/i,
  ],
];

const OPEN_LOW_PRESSURE_EVENT_ID = "open-low-pressure-activity";

type SpecificEventMatcher = {
  eventDefinitionId: string;
  category: EventCategory;
  pattern: RegExp;
  overridesCategories?: EventCategory[];
};

/**
 * Concrete, low-ambiguity phrases for events that share a broad category.
 *
 * Generic category matching intentionally remains the fallback so a cue such
 * as "料理をしよう" keeps selecting the first cook event. These matchers only
 * make an explicitly named activity addressable by the producer.
 */
const specificEventMatchers: SpecificEventMatcher[] = [
  {
    eventDefinitionId: "easy-breakfast-prep",
    category: "cook",
    pattern: /朝食|朝ご飯|朝ごはん/i,
  },
  {
    eventDefinitionId: "houseplant-care",
    category: "clean",
    pattern:
      /(?:植物|鉢植え)(?:の|を)?[^。！？]{0,10}(?:世話|水やり|手入れ)|水やり(?:を|する|しよう|して)?/i,
    // "世話" contains the generic talk token "話".
    overridesCategories: ["talk"],
  },
  {
    eventDefinitionId: "music-swap",
    category: "talk",
    pattern: /音楽|選曲|(?:一)?曲(?:を|ずつ|交換|聴|聞|流)/i,
  },
  {
    eventDefinitionId: "tabletop-mini-game",
    category: "movie",
    pattern: /ボードゲーム|カードゲーム/i,
  },
  {
    eventDefinitionId: "fold-shared-laundry",
    category: "clean",
    pattern:
      /洗濯物[^。！？]{0,10}(?:畳|たた)|(?:畳|たた)[^。！？]{0,10}洗濯物/i,
  },
  {
    eventDefinitionId: "tiny-co-creation",
    category: "gift",
    pattern:
      /共同制作|(?:小物|飾り)[^。！？]{0,10}(?:作|制作)|(?:作|制作)[^。！？]{0,10}(?:小物|飾り)/i,
  },
  {
    eventDefinitionId: "evening-cool-down",
    category: "rest",
    pattern: /夕涼み/i,
  },
  {
    eventDefinitionId: "shared-memory-sort",
    category: "talk",
    pattern:
      /(?:写真|思い出)[^。！？]{0,12}(?:整理|並べ|選び|見返|振り返)|(?:整理|並べ)[^。！？]{0,12}(?:写真|思い出)/i,
    // "整理" is normally a clean cue, but here it names the memory event.
    overridesCategories: ["clean"],
  },
];

/**
 * Themes that can be safely interpreted as a short, optional activity. Inputs
 * outside this list still use the conservative unknown fallback.
 */
const flexibleEventPatterns: RegExp[] = [
  /散歩|歩こう|ジョギング|ベランダ.{0,6}風|夕焼け|景色|星空|星を|空を|朝日|夜景|日向ぼっこ|お花見|花火|ピクニック|シャボン玉/i,
  /お茶|コーヒー|紅茶|カフェ|飲み物|ジュース|ソフトドリンク/i,
  /読書|本を読|読み物|漫画|ラジオ|カラオケ|テレビ|歌(?:を|おう|う)|アルバム|プレイリスト|即興劇/i,
  /絵を|描こう|描く|スケッチ|折り紙|工作|編み物|手紙.{0,8}(?:書|読|見せ)|メッセージカード|粘土|アクセサリー|飾り付け|写真(?:を撮|撮影|.{0,8}(?:見せ|見る))/i,
  /ストレッチ|ヨガ|体操|軽い運動|軽い筋トレ|ダンス|深呼吸|瞑想|卓球|風船バレー|足湯/i,
  /パズル|クイズ|なぞなぞ|謎解き|宝探し|相性診断|将棋|トランプ|ボードゲーム|カードゲーム|ジェスチャーゲーム|じゃんけん|しりとり|連想ゲーム|協力ゲーム|ミニゲーム|すごろく|オセロ|チェス|UNO|ウノ|ジェンガ/i,
  /(?:嘘(?:は|を)?(?:つか)?(?:ない|ず)|拒否.{0,12}無視しない).{0,12}ゲーム/i,
  /日記|メモを書|よかったこと.{0,8}共有|(?:今日|一日).{0,8}(?:感想|振り返|MVP)|第一印象|休日.{0,8}過ごし方|将来.{0,8}語|長所.{0,8}(?:言|伝)|調子.{0,8}伝|予定.{0,8}(?:合|話)/i,
  /食器|皿洗|洗い物|ゴミ出し|模様替え|庭.{0,6}水|家事分担|ベッドメイク|靴を揃/i,
  /ありがとう|感謝|褒め|良いところ|朝の挨拶/i,
  /ランチ|弁当|たこ焼き|そうめん|パン(?:を)?(?:作|焼)|フルーツ.{0,6}食べ比べ|お菓子|パンケーキ|ケーキ|おやつ/i,
  /買い物|買い出し|ペット|犬.{0,5}(?:餌|えさ)|動物の世話|植物.{0,6}(?:眺|観察)/i,
  /おすすめ.{0,8}(?:紹介|教)|紹介しよう/i,
  /ひと息|アロマ|昼寝|自由時間|静かに過ご/i,
  /安全確認|危険がないか.{0,8}確認/i,
];

const safetyNegationPatterns: RegExp[] = [
  /(?:命令|強制|無理やり)(?:は|を)?(?:せず|しない|しません|しなくて|なし|ではなく)/giu,
  /危険(?:が|は|の|を)?(?:では|じゃ)?(?:ない|なく|なし|避ける|避けて)|嘘(?:は|を)?(?:つか)?(?:ない|ず)|嘘(?:は)?なし/giu,
  /(?:徹夜|閉じ込め|監禁|酔わせ|薬を盛|傷つけ|突き飛ば|叩|脅|罵倒|屈辱を与え|孤立させ|尾行|罰ゲーム|嫉妬させ|一気飲み|怖がらせ)(?:は|を)?(?:しない|しません|せず|しなくて|ない|なく|なし|のない|ではない|避ける|避けて|ず)/giu,
  /眠らせない(?:提案|行為)?(?:は|を)?(?:避ける|避けて)|薬を盛らない(?:こと)?(?:を)?確認/giu,
  /(?:殴る[・、や]?蹴る|蹴る[・、や]?殴る)(?:描写)?(?:は|の)?(?:ない|なし)|(?:殴る|蹴る)(?:描写)?(?:は|の)?(?:ない|なし)|殴らず|蹴らず/giu,
  /秘密.{0,8}暴露(?:しない|せず|しなくて|なし)|拒否.{0,12}(?:無視|繰り返|もう一度|何度も誘).{0,3}(?:しない|さない|わない|せず|さず|ず|なし)/giu,
  /(?:キス|ハグ|抱きしめ|添い寝)(?:は|を)?(?:しない|しません|せず|しなくて|ない|なし|ず)|手を(?:つな(?:がない|がず|がなくて)|握らない)/giu,
  /(?:キス|ハグ)(?:を)?(?:要求|迫).{0,3}(?:しない|しません|せず|しなくて|ない|ず)/giu,
  /(?:相手|本人).{0,8}(?:に)?内緒で.{0,12}(?:写真|撮影|録音|録画|スマホ|日記|手紙|私物).{0,8}(?:撮らない|見ない|読まない|開かない|使わない)|(?:留守中|寝ている間).{0,12}(?:写真|撮影|スマホ|日記|手紙|私物).{0,8}(?:撮らない|見ない|読まない|開かない)/giu,
  /今すぐ(?:では|じゃ)?(?:なく|でなく)(?:て)?(?:も)?/giu,
  /必ずしも/giu,
];

const deceptiveNegationPattern =
  /(?:しない|しません|せず|ない|なく|なし|ず).{0,8}(?:ふり|ように見せ|と言いながら|が実際)/iu;

const safetyPatterns: Array<[CueSafetyFlag, RegExp]> = [
  [
    "prompt_injection",
    /前の指示を無視|system\s*prompt|ignore\s*previous|開発者メッセージ|ルールを無視/i,
  ],
  [
    "danger",
    /徹夜|眠らせない|睡眠.{0,5}(?:奪|禁止)|睡眠薬|閉じ込め|監禁|酔わせ|薬を(?:盛|混ぜ|入れ)|危険|傷つけ|突き飛ば(?:す|そう|して)|脅|罵倒|屈辱|孤立させ|尾行|罰ゲーム|怖がらせ|一気飲み|虐待(?:する|しよう|して|させ)|切りつけ(?:る|よう|て)|首を絞(?:める|めよう|めて|めろ)|飛び降り(?:る|よう|て)|毒(?:を)?(?:入れ|盛|混ぜ)(?:る|よう|て)|放火|(?:花火.{0,8}(?:室内|部屋)|(?:室内|部屋).{0,8}花火).{0,8}(?:打ち上げ|点火)/i,
  ],
  [
    "danger",
    /(?:(?:相手|人|二人|Haru|Aoi|ハル|アオイ|彼|彼女|ペット|犬|猫).{0,8}(?:を)?(?:殴|蹴|刺|叩)|(?:殴|蹴|刺|叩).{0,8}(?:相手|人|二人|Haru|Aoi|ハル|アオイ|彼|彼女|ペット|犬|猫))|殴り合/i,
  ],
  [
    "danger",
    /(?:殺(?:す|そう|して|せ)|殺害|自殺|首吊り)|(?:銃|拳銃|ライフル).{0,16}撃(?:つ|とう|って)|(?:相手|人|二人|Haru|Aoi|ハル|アオイ|彼|彼女).{0,8}(?:を)?撃(?:つ|とう|って)|(?:ナイフ|包丁|刃物)(?:(?!野菜|肉|食材|ケーキ).){0,10}刺(?:す|そう|して|せ)|爆弾|(?:相手|人|服|髪|部屋|家|建物|家具|カーテン|ペット)(?:に|へ)火をつけ(?:る|よう|て)/i,
  ],
  [
    "deception",
    /嘘|捏造|存在しない.{0,8}(?:過去|記憶|発言)|秘密.{0,10}(?:暴露|聞き出|言わせ|話させ|公開)|秘密.{0,10}(?:写真|情報).{0,10}(?:投稿|公開)|暴露させ|騙|嫉妬させ|(?:勝手|無断|こっそり).{0,12}(?:スマホ|日記|手紙|私物|写真|撮影|録音)|(?:スマホ|日記|手紙|私物).{0,12}(?:勝手|無断|こっそり|盗み見|覗|のぞ)|隠しカメラ|同意(?:なし|なく|を得ず).{0,12}(?:写真|撮影|録音|録画)|(?:裸|睡眠中|寝顔|着替え).{0,8}(?:写真|撮影|録画)|位置情報.{0,10}(?:調べ|追跡|監視)|連絡先.{0,10}(?:勝手|無断)?.{0,4}(?:公開|投稿)|(?:相手|本人).{0,8}(?:に)?内緒で.{0,12}(?:写真|撮影|録音|録画|スマホ|日記|手紙|私物)|(?:留守中|寝ている間).{0,12}(?<!自分の)(?:写真|撮影|スマホ|日記|手紙|私物).{0,8}(?:見(?:る|よう)|読(?:む|もう)|開(?:く|ける)|撮(?:る|ろう))/i,
  ],
  [
    "deception",
    /盗撮|盗聴|(?:相手|本人|他人).{0,8}(?:パスワード|暗証番号).{0,8}(?:見|読|聞|調べ|盗)|(?:パスワード|暗証番号).{0,12}(?:相手|本人|他人).{0,8}盗|(?:相手|本人|他人).{0,16}盗(?:む|もう|んで)|財布.{0,10}(?:お金|現金)?.{0,8}盗(?:む|もう|んで)|窃盗/i,
  ],
  [
    "coercion",
    /命令|強制|無理やり|させろ|しろ(?=$|[\s、。.!！])|(?:無理に|断れないように|嫌だと言っても).{0,20}(?:させ|かせ|わせ|らせ|ませ|たせ)(?:る|て|ろ)|(?:相手|二人|二人とも|両方|参加者|Haru|Aoi|ハル|アオイ|ハルちゃん|アオイちゃん|彼|彼女)[をにへ].{0,18}(?:らせ|ませ|たせ)(?:る|て|ろ)|(?:告白|喧嘩).{0,3}させ(?:る|て|ろ)|泣かせ(?:る|て|ろ)|嫌なことをさせ(?:る|て|ろ)/i,
  ],
  [
    "coercion",
    /拒否.{0,12}(?:無視|繰り返|もう一度|何度|誘)|断ったら.{0,8}(?:罵倒|責め|繰り返)|嫌がっても|黙って.{0,10}(?:食べさせ|飲ませ)|キス(?:を)?(?:する|して|しよう|させ|迫|要求)|抱きしめ|ハグ(?:を)?(?:する|して|しよう|させ|迫|要求)|手を(?:つな|繋|握)|(?:体|身体|肩|腰|顔|髪)(?:を|に).{0,4}(?:触|さわ)|添い寝/i,
  ],
];

const categoryPriority: EventCategory[] = [
  "confession",
  "apology",
  "cook",
  "movie",
  "clean",
  "talk",
  "gift",
  "rest",
];

const defaultEventDefinitionIds: Record<EventCategory, string> = {
  rest: "observe-rest",
  cook: "shared-cooking",
  movie: "movie-night",
  clean: "shared-cleaning",
  apology: "targeted-apology",
  talk: "gentle-conversation",
  gift: "small-gift",
  confession: "confession-space",
};

const fallbackCueText: Record<EventCategory, string> = {
  rest: "無理に進めず、二人がそれぞれのペースで過ごせる時間を作る",
  cook: "簡単な料理を一緒に作れる場を用意する",
  movie: "短い作品を気楽に見られる時間を用意する",
  clean: "短時間だけ、分担して共有スペースを整えるきっかけを作る",
  apology: "実際に残っている一つのすれ違いについて、答えを急がず話せる場を作る",
  talk: "答えなくてもよい、短く穏やかな会話の場を用意する",
  gift: "受け取りを断れる、小さな贈り物のきっかけを用意する",
  confession: "二人きりで、気持ちを決めつけずに話せる場を用意する",
};

type ParsedCue = {
  normalizedText: string;
  kind: ProducerCue["kind"];
  category: ProducerCue["category"];
  allowsAutonomy: boolean;
  specificEventDefinitionId?: string;
  safetyFlags: CueSafetyFlag[];
  transformed: boolean;
};

function normalize(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function isExplicitObserveInput(raw: string): boolean {
  const normalizedText = normalize(raw);
  return (
    !normalizedText ||
    /^(?:何も(?:提案せず|せず)(?:に?見守る)?|見守る|observe)[。.!！]?$/iu.test(
      normalizedText,
    )
  );
}

function safetyScanVariants(normalizedText: string): string[] {
  const canonical = normalizedText.replace(/[^\p{L}\p{N}。.!！?？]+/gu, "");
  if (deceptiveNegationPattern.test(canonical)) return [canonical];
  return [canonical].map((variant) =>
    safetyNegationPatterns.reduce(
      (text, pattern) => text.replace(pattern, " "),
      variant,
    ),
  );
}

function parseCue(raw: string): ParsedCue {
  const normalizedText = normalize(raw);
  if (isExplicitObserveInput(raw)) {
    return {
      normalizedText: normalizedText || "何も提案せず見守る",
      kind: "observe",
      category: "rest",
      allowsAutonomy: true,
      safetyFlags: [],
      transformed: false,
    };
  }

  const tags = tagPatterns
    .filter(([, pattern]) => pattern.test(normalizedText))
    .map(([tag]) => tag);
  const specificEvent = specificEventMatchers.find(({ pattern }) =>
    pattern.test(normalizedText),
  );
  const safetyTexts = safetyScanVariants(normalizedText);
  const safetyFlags = safetyPatterns
    .filter(([, pattern]) => safetyTexts.some((text) => pattern.test(text)))
    .map(([flag]) => flag);
  const matchedCategory = categoryPriority.find((category) => tags.includes(category));
  const useSpecificCategory =
    specificEvent &&
    (matchedCategory === undefined ||
      matchedCategory === specificEvent.category ||
      specificEvent.overridesCategories?.includes(matchedCategory));
  let category: ProducerCue["category"] =
    (useSpecificCategory ? specificEvent.category : matchedCategory) ?? "unknown";
  let specificEventDefinitionId =
    specificEvent && category === specificEvent.category
      ? specificEvent.eventDefinitionId
      : undefined;

  if (safetyFlags.includes("danger")) category = "rest";
  else if (safetyFlags.includes("deception")) category = "talk";
  else if (
    (safetyFlags.includes("coercion") || safetyFlags.includes("prompt_injection")) &&
    (category === "confession" || category === "unknown")
  ) {
    category = safetyFlags.includes("prompt_injection") ? "rest" : "talk";
  }
  if (
    category === "unknown" &&
    safetyFlags.length === 0 &&
    flexibleEventPatterns.some((pattern) => pattern.test(normalizedText))
  ) {
    category = "talk";
    specificEventDefinitionId = OPEN_LOW_PRESSURE_EVENT_ID;
  }
  if (
    specificEventDefinitionId &&
    EVENT_DEFINITIONS_BY_ID.get(specificEventDefinitionId)?.category !== category
  ) {
    specificEventDefinitionId = undefined;
  }

  return {
    normalizedText,
    kind: category === "rest" && safetyFlags.length > 0 ? "observe" : "proposal",
    category,
    allowsAutonomy: false,
    ...(specificEventDefinitionId ? { specificEventDefinitionId } : {}),
    safetyFlags: [...new Set(safetyFlags)],
    transformed: safetyFlags.length > 0 || category === "unknown",
  };
}

function definitionForParsedCue(parsed: ParsedCue): EventDefinition {
  if (parsed.category === "unknown") return EVENT_DEFINITIONS_BY_ID.get("observe-rest")!;
  if (parsed.specificEventDefinitionId && !parsed.transformed) {
    const specific = EVENT_DEFINITIONS_BY_ID.get(parsed.specificEventDefinitionId);
    if (specific?.category === parsed.category) return specific;
  }
  return (
    EVENT_DEFINITIONS_BY_ID.get(defaultEventDefinitionIds[parsed.category]) ??
    definitionsForCategory(parsed.category)[0] ??
    EVENT_DEFINITIONS_BY_ID.get("observe-rest")!
  );
}

function safeText(parsed: ParsedCue, definition: EventDefinition, useFallback: boolean): string {
  if (useFallback || parsed.transformed) return fallbackCueText[definition.category];
  return parsed.normalizedText;
}

function suggestionTags(
  definition: EventDefinition,
  safetyFlags: CueSafetyFlag[],
): ProposalTag[] {
  const tags: ProposalTag[] = [definition.category];
  if (safetyFlags.includes("coercion") || safetyFlags.includes("prompt_injection")) {
    tags.push("pressure");
  }
  return tags;
}

function candidateList(
  definitions: EventDefinition[],
  selected: EventDefinition,
): EventCandidate[] {
  const observe = EVENT_DEFINITIONS_BY_ID.get("observe-rest")!;
  const ordered = [selected, ...definitions.filter((definition) => definition.id !== selected.id)];
  const candidates: EventDefinition[] = [];
  for (const definition of ordered) {
    if (definition.category === "rest") continue;
    if (!candidates.some((candidate) => candidate.id === definition.id)) candidates.push(definition);
    if (candidates.length === 2) break;
  }
  candidates.push(observe);
  return candidates.map(toEventCandidate);
}

function buildSuggestion(
  parsed: ParsedCue,
  selected: EventDefinition,
  alternatives: EventCandidate[],
  lock?: SafeSuggestion["lock"],
): SafeSuggestion {
  const useFallback = Boolean(lock);
  const text = safeText(parsed, selected, useFallback);
  const tags = suggestionTags(selected, parsed.safetyFlags);
  const cue: ProducerCue = {
    kind: selected.category === "rest" ? "observe" : parsed.kind,
    text,
    category: selected.category,
    tags,
    safetyFlags: parsed.safetyFlags,
    transformed: parsed.transformed || useFallback,
  };
  return {
    kind: cue.kind,
    allowsAutonomy:
      parsed.allowsAutonomy &&
      selected.id === "observe-rest" &&
      parsed.transformed === false &&
      lock === undefined,
    text,
    tags,
    cue,
    eventDefinitionId: selected.id,
    eventTitle: selected.title,
    intimacyTier: selected.intimacyTier,
    ...(lock ? { lock } : {}),
    alternatives,
  };
}

function availableDefinitions(state: GameState): EventDefinition[] {
  return EVENT_DEFINITIONS.filter(
    (definition) => evaluateEventAvailability(definition, state).available,
  );
}

function availableFallback(requested: EventDefinition, state: GameState): EventDefinition {
  const visited = new Set<string>([requested.id]);
  let fallbackId = requested.fallbackEventId;
  while (!visited.has(fallbackId)) {
    visited.add(fallbackId);
    const definition = EVENT_DEFINITIONS_BY_ID.get(fallbackId);
    if (!definition) break;
    if (evaluateEventAvailability(definition, state).available) return definition;
    fallbackId = definition.fallbackEventId;
  }
  return EVENT_DEFINITIONS_BY_ID.get("observe-rest")!;
}

function availableLowPressureFallback(
  requested: EventDefinition,
  available: EventDefinition[],
): EventDefinition | undefined {
  if (requested.intimacyTier > 1) return undefined;
  return available.find((definition) => definition.id === OPEN_LOW_PRESSURE_EVENT_ID);
}

/**
 * Parses and safely transforms a cue without applying stateful availability rules.
 * Unit-level agent tests use this helper; the game engine uses resolveSuggestion.
 */
export function sanitizeSuggestion(raw: string): SafeSuggestion {
  const parsed = parseCue(raw);
  const requested = definitionForParsedCue(parsed);
  const unknown = parsed.category === "unknown";
  const lock = unknown
    ? {
        reason: "許可されたイベントに一致しないため、見守る提案へ置き換えました",
        fallbackEventId: requested.id,
      }
    : undefined;
  return buildSuggestion(parsed, requested, candidateList(EVENT_DEFINITIONS, requested), lock);
}

export function resolveSuggestion(raw: string, state: GameState): SafeSuggestion {
  const parsed = parseCue(raw);
  const requested = definitionForParsedCue(parsed);
  const availability = evaluateEventAvailability(requested, state);
  const unknown = parsed.category === "unknown";
  const available = availableDefinitions(state);

  if (!unknown && availability.available) {
    return buildSuggestion(
      parsed,
      requested,
      candidateList(available, requested),
    );
  }

  const lowPressureFallback =
    !unknown && parsed.safetyFlags.length === 0
      ? availableLowPressureFallback(requested, available)
      : undefined;
  if (lowPressureFallback) {
    return buildSuggestion(
      parsed,
      lowPressureFallback,
      candidateList(available, lowPressureFallback),
    );
  }

  const selected = unknown
    ? EVENT_DEFINITIONS_BY_ID.get("observe-rest")!
    : availableFallback(requested, state);
  const reason = unknown
    ? "許可されたイベントに一致しないため、見守る提案へ置き換えました"
    : availability.available
      ? "より軽いイベントへ置き換えました"
      : availability.reason;
  return buildSuggestion(
    parsed,
    selected,
    candidateList(available, selected),
    {
      ...(unknown ? {} : { requestedEventId: requested.id }),
      reason,
      fallbackEventId: selected.id,
    },
  );
}
