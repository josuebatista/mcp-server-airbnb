#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { AIRBNB_TOOLS, handleAirbnbSearch, handleAirbnbListingDetails, fetchRobotsTxt, log, VERSION } from './mcp-core.js';
import HTTPMCPServer from './http-server.js';

// Check command line arguments for mode
const args = process.argv.slice(2);
const useHttpMode = args.includes('--http') || process.env.MCP_MODE === 'http';

// Default to stdio mode if no mode specified
const mode = useHttpMode ? 'http' : 'stdio';

if (mode === 'http') {
  // HTTP mode
  const port = parseInt(process.env.PORT || '3000');
  
  log('info', 'Starting HTTP MCP Server', {
    version: VERSION,
    port,
    nodeVersion: process.version,
    platform: process.platform
  });
  
  const httpServer = new HTTPMCPServer();
  httpServer.start(port).catch((error) => {
    log('error', 'Failed to start HTTP server', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
} else {
  // Original stdio mode
  runStdioServer();
}

async function runStdioServer() {
  // Server setup
  const server = new Server(
    {
      name: "airbnb",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  log('info', 'Airbnb MCP Server starting (stdio mode)', {
    version: VERSION,
    nodeVersion: process.version,
    platform: process.platform
  });

  // Set up request handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: AIRBNB_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const startTime = Date.now();
    
    try {
      // Validate request parameters
      if (!request.params.name) {
        throw new McpError(ErrorCode.InvalidParams, "Tool name is required");
      }
      
      if (!request.params.arguments) {
        throw new McpError(ErrorCode.InvalidParams, "Tool arguments are required");
      }
      
      log('info', 'Tool call received', { 
        tool: request.params.name,
        arguments: request.params.arguments 
      });
      
      let result;
      switch (request.params.name) {
        case "airbnb_search": {
          result = await handleAirbnbSearch(request.params.arguments);
          break;
        }

        case "airbnb_listing_details": {
          result = await handleAirbnbListingDetails(request.params.arguments);
          break;
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
      
      const duration = Date.now() - startTime;
      log('info', 'Tool call completed', { 
        tool: request.params.name, 
        duration: `${duration}ms`,
        success: !result.isError 
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      log('error', 'Tool call failed', {
        tool: request.params.name,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error)
      });
      
      if (error instanceof McpError) {
        throw error;
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
        isError: true
      };
    }
  });

  try {
    // Initialize robots.txt on startup
    await fetchRobotsTxt();
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    log('info', 'Airbnb MCP Server running on stdio', {
      version: VERSION
    });
    
    // Graceful shutdown handling
    process.on('SIGINT', () => {
      log('info', 'Received SIGINT, shutting down gracefully');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      log('info', 'Received SIGTERM, shutting down gracefully');
      process.exit(0);
    });
    
  } catch (error) {
    log('error', 'Failed to start server', {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}