import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createLogger } from "@llm-service/logger";

const logger = createLogger("MCP_MANAGER");

export interface MCPServerConfig {
  name: string;
  type: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
}

export interface MCPToolInfo {
  serverName: string;
  toolName: string;
  description?: string;
  inputSchema: unknown;
}

export class MCPManager {
  private clients: Map<string, Client>;
  private availableTools: Map<string, MCPToolInfo>;

  constructor() {
    this.clients = new Map();
    this.availableTools = new Map();
  }

  async initialize(servers: MCPServerConfig[]): Promise<void> {
    for (const server of servers) {
      if (!server.enabled) {
        logger.info(`Skipping disabled MCP server: ${server.name}`);
        continue;
      }

      try {
        const client = await this.connectToServer(server);
        this.clients.set(server.name, client);

        // List available tools from this server
        const tools = await client.listTools();
        for (const tool of tools.tools) {
          const toolKey = `${server.name}:${tool.name}`;
          this.availableTools.set(toolKey, {
            serverName: server.name,
            toolName: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }

        logger.info(
          `Connected to MCP server: ${server.name} (${tools.tools.length} tools)`
        );
      } catch (error) {
        logger.error(`Failed to connect to MCP server ${server.name}`, error);
      }
    }
  }

  private async connectToServer(config: MCPServerConfig): Promise<Client> {
    const client = new Client(
      {
        name: "llm-service",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    let transport;
    if (config.type === "stdio") {
      if (!config.command) {
        throw new Error(`stdio server ${config.name} missing command`);
      }
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env },
      });
    } else {
      if (!config.url) {
        throw new Error(`sse server ${config.name} missing url`);
      }
      transport = new SSEClientTransport(new URL(config.url));
    }

    await client.connect(transport);
    return client;
  }

  listAvailableTools(): MCPToolInfo[] {
    return Array.from(this.availableTools.values());
  }

  getToolInfo(toolKey: string): MCPToolInfo | undefined {
    return this.availableTools.get(toolKey);
  }

  async executeTool(
    toolKey: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const toolInfo = this.availableTools.get(toolKey);
    if (!toolInfo) {
      throw new Error(`MCP tool not found: ${toolKey}`);
    }

    const client = this.clients.get(toolInfo.serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${toolInfo.serverName}`);
    }

    const result = await client.callTool({
      name: toolInfo.toolName,
      arguments: args,
    });

    return result;
  }

  async cleanup(): Promise<void> {
    const clientEntries = Array.from(this.clients.entries());
    for (const [name, client] of clientEntries) {
      try {
        await client.close();
        logger.info(`Closed MCP connection: ${name}`);
      } catch (error) {
        logger.error(`Failed to close MCP connection: ${name}`, error);
      }
    }
    this.clients.clear();
    this.availableTools.clear();
  }
}

export const mcpManager = new MCPManager();
