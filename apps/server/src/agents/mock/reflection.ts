import type { CharacterId } from "@roommates/shared";
import {
  REFLECTION_VERSION,
  agentResultReflectionSchemaFor,
  type AgentReflectionInput,
  type AgentResultReflection,
} from "../reflection.js";

function savedEventComment(input: AgentReflectionInput, eventLogId: string): string {
  const event = input.sharedEvents.find((candidate) => candidate.eventLogId === eventLogId);
  if (!event) return "コメントを取得できませんでした。";
  if (event.selfDialogue) return `この場面で伝えた「${event.selfDialogue.slice(0, 180)}」という言葉が、今も心に残っています。`;
  if (event.selfPublicReason && event.selfAction) {
    return `「${event.selfPublicReason.slice(0, 100)}」と考え、${event.selfAction.slice(0, 100)}ことを自分で選びました。`;
  }
  if (event.selfPublicReason) return `このときに伝えた理由は「${event.selfPublicReason.slice(0, 180)}」でした。`;
  if (event.selfAction) return `この場面では、${event.selfAction.slice(0, 180)}ことを選びました。`;
  return "この場面について保存された本人の公開コメントはありません。";
}

function seasonImpression(input: AgentReflectionInput): string {
  const relationship = input.finalRelationship;
  const otherName = input.otherCharacterIdentity?.displayName ?? "相手";
  if (input.characterId === "haru") {
    return `7日間を振り返ると、提案を受ける場面でも立ち止まる場面でも、自分のペースで選べたことが心に残っています。共有した出来事を一つずつ重ねて、${otherName}との関係が「${relationship}」になった今も、急がず向き合えた時間だったと思います。`;
  }
  return `7日間を振り返ると、一緒に動いた時間も、それぞれで過ごした時間も、自分で選べたことが心に残っています。共有した出来事を一つずつ重ねて、${otherName}との関係が「${relationship}」になった今、この生活を素直に振り返れてよかったです。`;
}

export class MockReflectionAgent {
  constructor(private readonly characterId: CharacterId) {}

  async reflect(input: AgentReflectionInput): Promise<AgentResultReflection> {
    if (input.characterId !== this.characterId) {
      throw new Error("Reflection input belongs to a different character");
    }
    const firstEvent = input.sharedEvents[0];
    const relationshipChange = input.sharedEvents.find(
      (event) => event.relationshipBefore !== event.relationshipAfter,
    );

    return agentResultReflectionSchemaFor(input).parse({
      characterId: this.characterId,
      seasonImpression: seasonImpression(input),
      notableEventComments: input.highlightEventLogIds.map((eventLogId) => ({
        eventLogId,
        comment: savedEventComment(input, eventLogId),
      })),
      bestMomentEventLogId:
        input.highlightEventLogIds[0] ?? relationshipChange?.eventLogId ?? firstEvent?.eventLogId ?? null,
      turningPointEventLogId: relationshipChange?.eventLogId ?? null,
      messageToProducer:
        this.characterId === "haru"
          ? "提案を命令にせず、立ち止まる選択も含めて見守ってくれてありがとう。"
          : "動くときも休むときも、私たち自身で選べる余白を残してくれてありがとう。",
      reflectionVersion: REFLECTION_VERSION,
    });
  }
}
