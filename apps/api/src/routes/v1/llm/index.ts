import type { Route } from "../../types";
import { generateAnswerHandler } from "./handler";
import { generateImageHandler } from "./images";
import { listToolsHandler } from "./tools";
import {
  getConversationHandler,
  listConversationsHandler,
  deleteConversationHandler,
} from "./conversations";

export const llmRoutes: Route[] = [
  {
    path: "/v1/llm/answers",
    handler: generateAnswerHandler,
    methods: ["POST"],
  },
  {
    path: "/v1/llm/images",
    handler: generateImageHandler,
    methods: ["POST"],
  },
  {
    path: "/v1/llm/tools",
    handler: listToolsHandler,
    methods: ["GET"],
  },
  {
    path: "/v1/llm/conversations",
    handler: listConversationsHandler,
    methods: ["GET"],
  },
  {
    path: "/v1/llm/conversations/:conversationId",
    handler: getConversationHandler,
    methods: ["GET"],
  },
  {
    path: "/v1/llm/conversations/:conversationId",
    handler: deleteConversationHandler,
    methods: ["DELETE"],
  },
];
