import type { Personality } from "../domain/characterSettings";
import {
  characterDecisionSchema,
  characterDecisionTypes,
  type CharacterAgentRequest,
  type CharacterDecision,
  type CharacterDecisionType,
  type CharacterSituation,
  type ProposalCategory
} from "./characterAgentContract";
import {
  getMockCurrentGoal,
  getMockDialogue,
  getMockReason
} from "./mockCharacterNarrative";

const DEFAULT_SCORES: Record<CharacterDecisionType, number> = {
  ACCEPT: 35,
  DECLINE: 8,
  MODIFY: 18,
  IGNORE: 4,
  INITIATE: 6
};

const DECISION_PRIORITY: readonly CharacterDecisionType[] = [
  "INITIATE",
  "ACCEPT",
  "MODIFY",
  "DECLINE",
  "IGNORE"
];

function normalizeScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

function applySituationScores(
  scores: Record<CharacterDecisionType, number>,
  personality: Personality,
  situation: CharacterSituation
): void {
  const fatigue = 100 - situation.energy;
  const needForSolitude =
    (fatigue / 100) * (personality.solitudeWhenTired / 100);

  scores.ACCEPT += situation.trust * 0.12 + situation.energy * 0.08;
  scores.MODIFY += situation.stress * 0.12 + fatigue * 0.08;
  scores.DECLINE += situation.stress * 0.15 + needForSolitude * 28;
  scores.IGNORE += situation.stress * 0.08 + needForSolitude * 18;
  scores.INITIATE += situation.energy * 0.07 + situation.trust * 0.05;
}

function applyPersonalityScores(
  scores: Record<CharacterDecisionType, number>,
  personality: Personality
): void {
  scores.ACCEPT +=
    personality.compassion * 0.12 +
    personality.cooperativeness * 0.2 +
    personality.sociability * 0.08;
  scores.MODIFY +=
    personality.romanticCaution * 0.16 +
    personality.compassion * 0.06;
  scores.DECLINE +=
    personality.independence * 0.05 +
    personality.solitudeWhenTired * 0.04;
  scores.IGNORE +=
    personality.independence * 0.04 +
    (100 - personality.expressiveness) * 0.03;
  scores.INITIATE +=
    personality.initiative * 0.32 +
    personality.expressiveness * 0.1 +
    personality.sociability * 0.12 -
    personality.valuesPartnerInitiative * 0.18;
}

function applyCategoryScores(
  scores: Record<CharacterDecisionType, number>,
  personality: Personality,
  category: ProposalCategory,
  situation: CharacterSituation
): void {
  switch (category) {
    case "romance":
      scores.ACCEPT -= personality.romanticCaution * 0.27;
      scores.MODIFY +=
        personality.romanticCaution * 0.28 +
        personality.valuesPartnerInitiative * 0.1;
      scores.DECLINE +=
        Math.max(0, personality.romanticCaution - situation.trust) * 0.24;
      scores.INITIATE +=
        personality.initiative * 0.12 -
        personality.romanticCaution * 0.16 +
        situation.relationship * 0.08;
      break;
    case "chore":
      scores.ACCEPT +=
        personality.cleanliness * 0.16 +
        personality.cooperativeness * 0.08;
      scores.INITIATE += personality.cleanliness * 0.1;
      break;
    case "rest":
      scores.ACCEPT += personality.independence * 0.08;
      scores.INITIATE += personality.independence * 0.08;
      scores.DECLINE -= personality.solitudeWhenTired * 0.08;
      break;
    case "conversation":
      scores.ACCEPT +=
        personality.sociability * 0.12 +
        personality.compassion * 0.06;
      scores.INITIATE += personality.expressiveness * 0.08;
      break;
    case "sharedActivity":
      scores.ACCEPT +=
        personality.sociability * 0.1 +
        personality.cooperativeness * 0.08;
      scores.INITIATE += personality.initiative * 0.08;
      break;
  }
}

function selectDecision(
  scores: Record<CharacterDecisionType, number>
): CharacterDecisionType {
  return DECISION_PRIORITY.reduce((bestDecision, currentDecision) =>
    scores[currentDecision] > scores[bestDecision]
      ? currentDecision
      : bestDecision
  );
}

export function decideWithMockAgent(
  request: CharacterAgentRequest
): CharacterDecision {
  const { personality } = request.character;
  const scores = { ...DEFAULT_SCORES };

  applyPersonalityScores(scores, personality);
  applySituationScores(scores, personality, request.situation);
  applyCategoryScores(
    scores,
    personality,
    request.proposal.category,
    request.situation
  );

  const normalizedScores = Object.fromEntries(
    characterDecisionTypes.map((decision) => [
      decision,
      normalizeScore(scores[decision])
    ])
  ) as Record<CharacterDecisionType, number>;
  const decision = selectDecision(normalizedScores);

  return characterDecisionSchema.parse({
    characterId: request.character.id,
    decision,
    dialogue: getMockDialogue(request.character, decision),
    reason: getMockReason(request.character, decision),
    currentGoal: getMockCurrentGoal(request.character, decision),
    scores: normalizedScores
  });
}
