import type { FunctionDeclaration } from "@google/genai";

export const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";

export const LIVE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "addNode",
    description:
      "Add a new node to the graph only when the user explicitly asks to introduce a new paper, concept, method, author, application, or technology.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: {
          type: "string",
          description: "The readable label for the new node.",
        },
        description: {
          type: "string",
          description: "Optional short description for the new node.",
        },
      },
      required: ["label"],
      propertyOrdering: ["label", "description"],
    },
  },
  {
    name: "addEdge",
    description:
      "Create a new relationship between two existing nodes only when the user explicitly asks to connect them.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: {
          type: "string",
          description: "The source node label or id.",
        },
        target: {
          type: "string",
          description: "The target node label or id.",
        },
        relation: {
          type: "string",
          description: "A short relationship phrase such as aligns with or extends.",
        },
      },
      required: ["source", "target"],
      propertyOrdering: ["source", "target", "relation"],
    },
  },
  {
    name: "highlightNode",
    description:
      "Highlight an existing node with a hex color only when the user explicitly asks to emphasize it.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nodeId: {
          type: "string",
          description: "The node id or visible label to highlight.",
        },
        color: {
          type: "string",
          description: "Hex color like #22d3ee.",
        },
      },
      required: ["nodeId", "color"],
      propertyOrdering: ["nodeId", "color"],
    },
  },
];

export interface LiveTokenResponse {
  token: string;
  model: string;
  issuedAt: string;
  expiresAt: string;
  newSessionExpiresAt: string;
}
