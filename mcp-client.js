#!/usr/bin/env node

/**
 * MCP Client for testing the Airbnb MCP Server
 * Usage: node mcp-client.js <server-url> <access-token> [command] [args...]
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

class MCPClient {
  constructor(serverUrl, accessToken) {
    this.serverUrl = serverUrl;
    this.accessToken = accessToken;
    this.requestId = 0;
  }

  async makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.serverUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'MCP-Client/1.0.0'
        }
      };

      if (data) {
        const jsonData = JSON.stringify(data);
        options.headers['Content-Length'] = Buffer.byteLength(jsonData);
      }

      const req = client.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: response
            });
          } catch (error) {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: body
            });
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  async healthCheck() {
    console.log('🔍 Checking server health...');
    try {
      const response = await this.makeRequest('GET', '/health');
      if (response.statusCode === 200) {
        console.log('✅ Server is healthy');
        console.log('📋 Server Info:', JSON.stringify(response.body, null, 2));
        return true;
      } else {
        console.log('❌ Server health check failed');
        console.log('Status:', response.statusCode);
        console.log('Response:', response.body);
        return false;
      }
    } catch (error) {
      console.log('❌ Health check failed:', error.message);
      return false;
    }
  }

  async listTools() {
    console.log('📋 Listing available tools...');
    try {
      const response = await this.makeRequest('POST', '/api/tools/list');
      if (response.statusCode === 200) {
        console.log('✅ Available tools:');
        response.body.tools.forEach((tool, index) => {
          console.log(`\n${index + 1}. ${tool.name}`);
          console.log(`   Description: ${tool.description}`);
          console.log(`   Required params: ${tool.inputSchema.required?.join(', ') || 'none'}`);
        });
        return response.body.tools;
      } else {
        console.log('❌ Failed to list tools');
        console.log('Status:', response.statusCode);
        console.log('Response:', response.body);
        return null;
      }
    } catch (error) {
      console.log('❌ Error listing tools:', error.message);
      return null;
    }
  }

  async callTool(toolName, args = {}) {
    console.log(`🔧 Calling tool: ${toolName}`);
    console.log('📥 Arguments:', JSON.stringify(args, null, 2));
    
    try {
      const response = await this.makeRequest('POST', '/api/tools/call', {
        name: toolName,
        arguments: args
      });
      
      if (response.statusCode === 200) {
        console.log('✅ Tool call successful');
        console.log('📤 Response:', JSON.stringify(response.body, null, 2));
        return response.body;
      } else {
        console.log('❌ Tool call failed');
        console.log('Status:', response.statusCode);
        console.log('Response:', response.body);
        return null;
      }
    } catch (error) {
      console.log('❌ Error calling tool:', error.message);
      return null;
    }
  }

  async searchAirbnb(location, options = {}) {
    console.log(`🏠 Searching Airbnb in: ${location}`);
    
    const params = {
      location,
      ...options
    };
    
    try {
      const response = await this.makeRequest('POST', '/api/airbnb/search', params);
      
      if (response.statusCode === 200) {
        console.log('✅ Search successful');
        
        if (response.body.content) {
          const result = JSON.parse(response.body.content[0].text);
          console.log(`📊 Found ${result.searchResults?.length || 0} listings`);
          
          if (result.searchResults) {
            result.searchResults.slice(0, 3).forEach((listing, index) => {
              console.log(`\n${index + 1}. ${listing.structuredContent?.primaryLine?.body || 'No title'}`);
              console.log(`   ID: ${listing.id}`);
              console.log(`   URL: ${listing.url}`);
              console.log(`   Price: ${listing.structuredDisplayPrice?.primaryLine?.accessibilityLabel || 'N/A'}`);
            });
          }
        }
        
        return response.body;
      } else {
        console.log('❌ Search failed');
        console.log('Status:', response.statusCode);
        console.log('Response:', response.body);
        return null;
      }
    } catch (error) {
      console.log('❌ Error searching:', error.message);
      return null;
    }
  }

  async getListingDetails(listingId, options = {}) {
    console.log(`🏡 Getting details for listing: ${listingId}`);
    
    const params = {
      id: listingId,
      ...options
    };
    
    try {
      const response = await this.makeRequest('POST', `/api/airbnb/listing/${listingId}`, params);
      
      if (response.statusCode === 200) {
        console.log('✅ Listing details retrieved');
        
        if (response.body.content) {
          const result = JSON.parse(response.body.content[0].text);
          console.log('📋 Listing Details:');
          console.log(`   URL: ${result.listingUrl}`);
          console.log(`   Sections: ${result.details?.length || 0}`);
          
          if (result.details) {
            result.details.forEach((section, index) => {
              console.log(`\n   Section ${index + 1}: ${section.id}`);
              if (section.title) console.log(`     Title: ${section.title}`);
              if (section.subtitle) console.log(`     Subtitle: ${section.subtitle}`);
            });
          }
        }
        
        return response.body;
      } else {
        console.log('❌ Failed to get listing details');
        console.log('Status:', response.statusCode);
        console.log('Response:', response.body);
        return null;
      }
    } catch (error) {
      console.log('❌ Error getting listing details:', error.message);
      return null;
    }
  }

  async runMCPCommand(method, params = {}) {
    console.log(`🔧 Running MCP command: ${method}`);
    
    const mcpRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method: method,
      params: params
    };
    
    try {
      const response = await this.makeRequest('POST', '/mcp', mcpRequest);
      
      if (response.statusCode === 200) {
        console.log('✅ MCP command successful');
        console.log('📤 Response:', JSON.stringify(response.body, null, 2));
        return response.body;
      } else {
        console.log('❌ MCP command failed');
        console.log('Status:', response.statusCode);
        console.log('Response:', response.body);
        return null;
      }
    } catch (error) {
      console.log('❌ Error running MCP command:', error.message);
      return null;
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node mcp-client.js <server-url> <access-token> [command] [args...]');
    console.log('');
    console.log('Commands:');
    console.log('  health                    - Check server health');
    console.log('  list                      - List available tools');
    console.log('  search <location>         - Search Airbnb listings');
    console.log('  details <listing-id>      - Get listing details');
    console.log('  call <tool-name> <args>   - Call a tool directly');
    console.log('  mcp <method> <params>     - Run raw MCP command');
    console.log('');
    console.log('Examples:');
    console.log('  node mcp-client.js https://your-server.com your-token health');
    console.log('  node mcp-client.js https://your-server.com your-token search "New York"');
    console.log('  node mcp-client.js https://your-server.com your-token details 12345');
    process.exit(1);
  }

  const serverUrl = args[0];
  const accessToken = args[1];
  const command = args[2] || 'health';

  const client = new MCPClient(serverUrl, accessToken);

  console.log('🚀 MCP Client Starting');
  console.log(`🌐 Server: ${serverUrl}`);
  console.log(`🔐 Token: ${accessToken.substring(0, 8)}...`);
  console.log(`📝 Command: ${command}`);
  console.log('');

  try {
    switch (command) {
      case 'health':
        await client.healthCheck();
        break;
        
      case 'list':
        await client.listTools();
        break;
        
      case 'search':
        if (args[3]) {
          const options = {};
          if (args[4]) options.checkin = args[4];
          if (args[5]) options.checkout = args[5];
          if (args[6]) options.adults = parseInt(args[6]);
          await client.searchAirbnb(args[3], options);
        } else {
          console.log('❌ Missing location parameter');
        }
        break;
        
      case 'details':
        if (args[3]) {
          const options = {};
          if (args[4]) options.checkin = args[4];
          if (args[5]) options.checkout = args[5];
          await client.getListingDetails(args[3], options);
        } else {
          console.log('❌ Missing listing ID parameter');
        }
        break;
        
      case 'call':
        if (args[3]) {
          const toolArgs = args[4] ? JSON.parse(args[4]) : {};
          await client.callTool(args[3], toolArgs);
        } else {
          console.log('❌ Missing tool name parameter');
        }
        break;
        
      case 'mcp':
        if (args[3]) {
          const params = args[4] ? JSON.parse(args[4]) : {};
          await client.runMCPCommand(args[3], params);
        } else {
          console.log('❌ Missing method parameter');
        }
        break;
        
      default:
        console.log(`❌ Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('💥 Unexpected error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = MCPClient;