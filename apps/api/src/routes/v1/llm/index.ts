import type { Route } from "../../types";
import { generateAnswerHandler } from "./handler";
import { generateImageHandler } from "./images";
import { listToolsHandler } from "./tools";

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
];
