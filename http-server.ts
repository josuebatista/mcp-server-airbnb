import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { AIRBNB_TOOLS, handleAirbnbSearch, handleAirbnbListingDetails, fetchRobotsTxt, log, VERSION } from './mcp-core.js';

interface AuthenticatedRequest extends Request {
  user?: {
    tokenHash: string;
  };
}

interface MCPRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: string;
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

class HTTPMCPServer {
  private app: express.Application;
  private server: Server;
  private validTokenHashes: Set<string> = new Set();

  constructor() {
    this.app = express();
    this.server = new Server(
      {
        name: "airbnb-http",
        version: VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    
    this.setupServer();
    this.setupAuthentication();
    this.setupRoutes();
  }

  private setupServer(): void {
    // Security middleware
    this.app.use(helmet());
    
    // CORS configuration
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
      credentials: true,
    }));
    
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      log('info', 'HTTP Request', {
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
      next();
    });
  }

  private setupAuthentication(): void {
    // Load PATs from environment
    const pats = process.env.MCP_ACCESS_TOKENS?.split(',') || [];
    
    if (pats.length === 0) {
      log('warn', 'No access tokens configured. Server will reject all requests.');
    }
    
    // Hash the PATs for secure storage
    pats.forEach(pat => {
      if (pat.trim()) {
        const hash = crypto.createHash('sha256').update(pat.trim()).digest('hex');
        this.validTokenHashes.add(hash);
        log('info', 'Access token loaded', { tokenHash: hash.substring(0, 8) + '...' });
      }
    });
  }

  private authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Missing or invalid authorization header. Expected: Bearer <token>'
      });
      return;
    }
    
    const token = authHeader.substring(7);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    if (!this.validTokenHashes.has(tokenHash)) {
      log('warn', 'Invalid token attempt', { 
        tokenHash: tokenHash.substring(0, 8) + '...',
        ip: req.ip 
      });
      res.status(401).json({
        error: 'Invalid access token'
      });
      return;
    }
    
    req.user = { tokenHash };
    next();
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        version: VERSION,
        timestamp: new Date().toISOString(),
        service: 'airbnb-mcp-server'
      });
    });

    // MCP Protocol endpoints
    this.app.post('/mcp', this.authenticateToken.bind(this), this.handleMCPRequest.bind(this));
    
    // RESTful endpoints for easier testing
    this.app.post('/api/tools/list', this.authenticateToken.bind(this), this.handleListTools.bind(this));
    this.app.post('/api/tools/call', this.authenticateToken.bind(this), this.handleCallTool.bind(this));
    
    // Airbnb-specific endpoints
    this.app.post('/api/airbnb/search', this.authenticateToken.bind(this), this.handleAirbnbSearchAPI.bind(this));
    this.app.post('/api/airbnb/listing/:id', this.authenticateToken.bind(this), this.handleAirbnbListingAPI.bind(this));

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested endpoint does not exist',
        availableEndpoints: [
          'GET /health',
          'POST /mcp',
          'POST /api/tools/list',
          'POST /api/tools/call',
          'POST /api/airbnb/search',
          'POST /api/airbnb/listing/:id'
        ]
      });
    });

    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      log('error', 'HTTP Server Error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
      });
      
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred'
      });
    });
  }

  private async handleMCPRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const mcpRequest: MCPRequest = req.body;
      
      // Validate MCP request format
      if (!mcpRequest.jsonrpc || mcpRequest.jsonrpc !== '2.0') {
        res.status(400).json({
          jsonrpc: '2.0',
          id: mcpRequest.id || null,
          error: {
            code: ErrorCode.InvalidRequest,
            message: 'Invalid JSON-RPC version'
          }
        });
        return;
      }

      let result: any;
      
      switch (mcpRequest.method) {
        case 'tools/list':
          result = { tools: AIRBNB_TOOLS };
          break;
          
        case 'tools/call':
          if (!mcpRequest.params?.name) {
            throw new McpError(ErrorCode.InvalidParams, 'Tool name is required');
          }
          
          result = await this.callTool(mcpRequest.params.name, mcpRequest.params.arguments || {});
          break;
          
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Method not found: ${mcpRequest.method}`);
      }

      const response: MCPResponse = {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result
      };

      res.json(response);
    } catch (error) {
      const response: MCPResponse = {
        jsonrpc: '2.0',
        id: req.body.id || null,
        error: {
          code: error instanceof McpError ? error.code : ErrorCode.InternalError,
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      };

      res.status(400).json(response);
    }
  }

  private async handleListTools(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      res.json({ tools: AIRBNB_TOOLS });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleCallTool(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { name, arguments: args } = req.body;
      
      if (!name) {
        res.status(400).json({ error: 'Tool name is required' });
        return;
      }

      const result = await this.callTool(name, args || {});
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleAirbnbSearchAPI(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await handleAirbnbSearch(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleAirbnbListingAPI(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const params = { id, ...req.body };
      
      const result = await handleAirbnbListingDetails(params);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async callTool(name: string, args: any): Promise<any> {
    switch (name) {
      case 'airbnb_search':
        return await handleAirbnbSearch(args);
      case 'airbnb_listing_details':
        return await handleAirbnbListingDetails(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  }

  public async start(port: number = parseInt(process.env.PORT || '8080')): Promise<void> {
    try {
      // Initialize robots.txt
      await fetchRobotsTxt();
      
      this.app.listen(port, () => {
        log('info', 'HTTP MCP Server started', {
          port,
          version: VERSION,
          endpoints: [
            `http://localhost:${port}/health`,
            `http://localhost:${port}/mcp`,
            `http://localhost:${port}/api/tools/list`,
            `http://localhost:${port}/api/tools/call`,
            `http://localhost:${port}/api/airbnb/search`,
            `http://localhost:${port}/api/airbnb/listing/:id`
          ]
        });
      });
    } catch (error) {
      log('error', 'Failed to start HTTP server', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

export default HTTPMCPServer;