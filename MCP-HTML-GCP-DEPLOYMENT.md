# Airbnb MCP Server - Cloud Run Deployment Guide

This guide explains how to deploy the Airbnb MCP Server to Google Cloud Run with Personal Access Token (PAT) authentication.

## Architecture Overview

The MCP server has been enhanced with:
- **HTTP API**: RESTful endpoints alongside the original MCP protocol
- **PAT Authentication**: Bearer token-based access control
- **Cloud Run Ready**: Containerized deployment with health checks
- **Dual Mode**: Supports both stdio (original) and HTTP modes

## Quick Deployment

### Prerequisites

1. **Google Cloud Account** with billing enabled
2. **gcloud CLI** installed and configured
3. **Docker** installed locally
4. **Node.js 18+** for local development

### 1. Set Up Google Cloud Project

```bash
# Set your project ID
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    containerregistry.googleapis.com \
    secretmanager.googleapis.com
```

### 2. Create Access Tokens

Generate secure access tokens for your MCP server:

```bash
# Generate a secure token (example)
openssl rand -hex 32

# Create the secret in Google Secret Manager
echo "your-token-1,your-token-2" | gcloud secrets create mcp-access-tokens --data-file=-
```

### 3. Deploy Using the Script

```bash
# Make deploy script executable
chmod +x deploy.sh

# Deploy to Cloud Run
./deploy.sh YOUR_PROJECT_ID us-central1
```

### 4. Test Your Deployment

```bash
# Get the service URL
SERVICE_URL=$(gcloud run services describe airbnb-mcp-server --region=us-central1 --format="value(status.url)")

# Test health endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" "$SERVICE_URL/health"

# Test with the CLI client
node mcp-client.js "$SERVICE_URL" "YOUR_TOKEN" health
```

## Manual Deployment

### 1. Build and Push Docker Image

```bash
# Build the image
docker build -t gcr.io/$PROJECT_ID/airbnb-mcp-server:latest .

# Push to Google Container Registry
docker push gcr.io/$PROJECT_ID/airbnb-mcp-server:latest
```

### 2. Deploy to Cloud Run

```bash
# Update cloud-run.yaml with your project ID
sed "s/PROJECT_ID/$PROJECT_ID/g" cloud-run.yaml > cloud-run-deploy.yaml

# Deploy the service
gcloud run services replace cloud-run-deploy.yaml \
    --region=us-central1 \
    --platform=managed

# Make service publicly accessible
gcloud run services add-iam-policy-binding airbnb-mcp-server \
    --region=us-central1 \
    --member="allUsers" \
    --role="roles/run.invoker"
```

## API Endpoints

Once deployed, your MCP server will expose these endpoints:

### Health Check
```
GET /health
```

### MCP Protocol
```
POST /mcp
Content-Type: application/json
Authorization: Bearer YOUR_TOKEN

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

### RESTful API
```
POST /api/tools/list
POST /api/tools/call
POST /api/airbnb/search
POST /api/airbnb/listing/:id
```

## Using the CLI Client

The included CLI client makes it easy to test your deployed server:

```bash
# Basic health check
node mcp-client.js https://your-server.com your-token health

# List available tools
node mcp-client.js https://your-server.com your-token list

# Search Airbnb listings
node mcp-client.js https://your-server.com your-token search "New York"

# Get listing details
node mcp-client.js https://your-server.com your-token details 12345
```

## Environment Variables

Configure your deployment with these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `3000` |
| `MCP_MODE` | Server mode (`http` or `stdio`) | `stdio` |
| `MCP_ACCESS_TOKENS` | Comma-separated access tokens | Required |
| `ALLOWED_ORIGINS` | CORS allowed origins | `*` |
| `IGNORE_ROBOTS_TXT` | Ignore robots.txt restrictions | `false` |
| `NODE_ENV` | Node.js environment | `production` |

## Security Considerations

1. **Access Tokens**: Use long, random tokens (32+ characters)
2. **CORS**: Configure `ALLOWED_ORIGINS` for production
3. **HTTPS**: Cloud Run provides HTTPS by default
4. **Rate Limiting**: Consider implementing rate limiting for production use
5. **Monitoring**: Set up Cloud Run monitoring and alerting

## CI/CD with GitHub Actions

The included GitHub Actions workflow automatically:
- Builds and tests the code
- Builds and pushes Docker images
- Deploys to Cloud Run
- Runs health checks

Required secrets:
- `GCP_PROJECT_ID`: Your Google Cloud project ID
- `GCP_SA_KEY`: Service account key JSON
- `MCP_ACCESS_TOKENS`: Comma-separated access tokens

## Local Development

Run the server locally in different modes:

```bash
# HTTP mode
npm run start:http

# stdio mode (original)
npm run start:stdio

# With environment variables
export MCP_ACCESS_TOKENS="test-token"
export PORT=3000
npm run start:http
```

## Troubleshooting

### Common Issues

1. **Authentication failures**: Check your access tokens
2. **CORS errors**: Configure `ALLOWED_ORIGINS`
3. **Build failures**: Ensure Node.js 18+ and all dependencies
4. **Deployment timeouts**: Check Cloud Run logs

### Debugging

```bash
# View Cloud Run logs
gcloud run services logs tail airbnb-mcp-server --region=us-central1

# Test locally with Docker
docker run -p 3000:3000 -e MCP_ACCESS_TOKENS="test-token" your-image

# Health check
curl -H "Authorization: Bearer test-token" http://localhost:3000/health
```

## Cost Optimization

Cloud Run pricing is based on:
- **CPU allocation**: 1 vCPU allocated
- **Memory**: 512MB allocated
- **Requests**: Pay per request
- **Idle time**: Minimal cost when not in use

Optimize costs by:
- Setting appropriate min/max scaling
- Using CPU boost only when needed
- Monitoring usage patterns

## Support

For issues and questions:
1. Check the deployment logs
2. Verify authentication setup
3. Test with the CLI client
4. Review environment variables

The MCP server is now ready for production use with secure authentication and scalable Cloud Run deployment!