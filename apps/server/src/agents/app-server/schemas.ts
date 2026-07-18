const statProperties = {
  energy: { type: "number", minimum: -100, maximum: 100 },
  stress: { type: "number", minimum: -100, maximum: 100 },
  affection: { type: "number", minimum: -100, maximum: 100 },
  trust: { type: "number", minimum: -100, maximum: 100 },
  romanticAwareness: { type: "number", minimum: -100, maximum: 100 },
};

const statDelta = { type: "object", properties: statProperties, additionalProperties: false };

export const characterOutputSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["ACCEPT", "DECLINE", "MODIFY", "IGNORE", "INITIATE"] },
    action: { type: "string" },
    dialogue: { type: "string" },
    publicReason: { type: "string" },
    internalSummary: { type: "string" },
    expectedEffects: statDelta,
  },
  required: ["decision", "action", "dialogue", "publicReason", "internalSummary", "expectedEffects"],
  additionalProperties: false,
};

export const directorOutputSchema = {
  type: "object",
  properties: {
    eventTitle: { type: "string" },
    narration: { type: "string" },
    haruDialogue: { type: "string" },
    aoiDialogue: { type: "string" },
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
      additionalProperties: false,
    },
    conflictUpdate: {
      type: "object",
      properties: {
        add: { type: "array", items: { type: "string" } },
        resolve: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  required: ["eventTitle", "narration", "haruDialogue", "aoiDialogue", "effects", "memory"],
  additionalProperties: false,
};
