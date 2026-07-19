const statProperties = {
  energy: { type: "number", minimum: -100, maximum: 100 },
  stress: { type: "number", minimum: -100, maximum: 100 },
  affection: { type: "number", minimum: -100, maximum: 100 },
  trust: { type: "number", minimum: -100, maximum: 100 },
  romanticAwareness: { type: "number", minimum: -100, maximum: 100 },
};

export const reflectionOutputSchema = {
  type: "object",
  properties: {
    characterId: { type: "string", enum: ["haru", "aoi"] },
    seasonImpression: { type: "string", minLength: 80, maxLength: 160 },
    notableEventComments: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          eventLogId: { type: "string", minLength: 1, maxLength: 200 },
          comment: { type: "string", minLength: 1, maxLength: 240 },
        },
        required: ["eventLogId", "comment"],
        additionalProperties: false,
      },
    },
    bestMomentEventLogId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 200 },
        { type: "null" },
      ],
    },
    turningPointEventLogId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 200 },
        { type: "null" },
      ],
    },
    messageToProducer: { type: "string", minLength: 1, maxLength: 240 },
    reflectionVersion: { type: "string", enum: ["reflection-v1"] },
  },
  required: [
    "characterId",
    "seasonImpression",
    "notableEventComments",
    "bestMomentEventLogId",
    "turningPointEventLogId",
    "messageToProducer",
    "reflectionVersion",
  ],
  additionalProperties: false,
};

const statDelta = {
  type: "object",
  properties: statProperties,
  required: ["energy", "stress", "affection", "trust", "romanticAwareness"],
  additionalProperties: false,
};

const storyBeat = {
  anyOf: [
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["move"] },
        actor: { type: "string", enum: ["haru", "aoi", "both"] },
        location: { type: "string", minLength: 1, maxLength: 48 },
      },
      required: ["kind", "actor", "location"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["dialogue"] },
        actor: { type: "string", enum: ["haru", "aoi"] },
        text: { type: "string", minLength: 1, maxLength: 160 },
      },
      required: ["kind", "actor", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["action"] },
        actor: { type: "string", enum: ["haru", "aoi", "both"] },
        action: { type: "string", minLength: 1, maxLength: 160 },
      },
      required: ["kind", "actor", "action"],
      additionalProperties: false,
    },
  ],
};

export const navigatorOutputSchema = {
  type: "object",
  properties: {
    message: { type: "string", minLength: 1, maxLength: 240 },
  },
  required: ["message"],
  additionalProperties: false,
};

export const characterOutputSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["ACCEPT", "DECLINE", "MODIFY", "IGNORE", "INITIATE"] },
    action: { type: "string" },
    dialogue: { type: "string", minLength: 1, maxLength: 160 },
    publicReason: { type: "string" },
    internalSummary: { type: "string" },
    expectedEffects: statDelta,
    initiative: {
      type: "object",
      properties: {
        candidateId: { type: "string", minLength: 1, maxLength: 200 },
        invitation: { type: "string", enum: ["solo", "open"] },
        publicIntent: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["candidateId", "invitation", "publicIntent"],
      additionalProperties: false,
    },
  },
  required: ["decision", "action", "dialogue", "publicReason", "internalSummary", "expectedEffects"],
  additionalProperties: false,
};

export const directorOutputSchema = {
  type: "object",
  properties: {
    eventTitle: { type: "string" },
    narration: { type: "string" },
    haruDialogue: { type: "string", minLength: 1, maxLength: 160 },
    aoiDialogue: { type: "string", minLength: 1, maxLength: 160 },
    conversation: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", enum: ["haru", "aoi"] },
          text: { type: "string", minLength: 1, maxLength: 160 },
        },
        required: ["speaker", "text"],
        additionalProperties: false,
      },
    },
    storyBeats: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: storyBeat,
    },
    effects: {
      type: "object",
      properties: { haru: statDelta, aoi: statDelta },
      required: ["haru", "aoi"],
      additionalProperties: false,
    },
    memory: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        emotionalImpact: { type: "number", minimum: -10, maximum: 10 },
        importance: { type: "number", minimum: 0, maximum: 10 },
      },
      required: ["title", "summary", "emotionalImpact", "importance"],
      additionalProperties: false,
    },
    scene: {
      type: "object",
      properties: { haru: { type: "string" }, aoi: { type: "string" } },
      required: ["haru", "aoi"],
      additionalProperties: false,
    },
    conflictUpdate: {
      type: "object",
      properties: {
        add: { type: "array", items: { type: "string" } },
        resolve: { type: "array", items: { type: "string" } },
      },
      required: ["add", "resolve"],
      additionalProperties: false,
    },
  },
  required: [
    "eventTitle",
    "narration",
    "haruDialogue",
    "aoiDialogue",
    "conversation",
    "storyBeats",
    "effects",
    "memory",
    "scene",
    "conflictUpdate",
  ],
  additionalProperties: false,
};
