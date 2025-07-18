#!/bin/bash

# Deploy script for Airbnb MCP Server to Google Cloud Run
# Usage: ./deploy.sh [PROJECT_ID] [REGION]

set -e

# Configuration
PROJECT_ID=${1:-your-project-id}
REGION=${2:-us-central1}
SERVICE_NAME="airbnb-mcp-server"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Deploying Airbnb MCP Server to Cloud Run${NC}"
echo -e "${YELLOW}Project ID: $PROJECT_ID${NC}"
echo -e "${YELLOW}Region: $REGION${NC}"
echo -e "${YELLOW}Service: $SERVICE_NAME${NC}"
echo ""

# Check if required tools are installed
command -v gcloud >/dev/null 2>&1 || { echo -e "${RED}❌ gcloud CLI is required but not installed.${NC}" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}❌ Docker is required but not installed.${NC}" >&2; exit 1; }

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo -e "${RED}❌ Not authenticated with gcloud. Please run 'gcloud auth login'${NC}"
    exit 1
fi

# Set project
echo -e "${GREEN}🔧 Setting up gcloud project...${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "${GREEN}🔧 Enabling required APIs...${NC}"
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    containerregistry.googleapis.com \
    secretmanager.googleapis.com

# Build and push Docker image
echo -e "${GREEN}🔨 Building and pushing Docker image...${NC}"
docker build -t $IMAGE_NAME .
docker push $IMAGE_NAME

# Create secrets for access tokens if they don't exist
echo -e "${GREEN}🔐 Setting up secrets...${NC}"
if ! gcloud secrets describe mcp-access-tokens >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Creating mcp-access-tokens secret...${NC}"
    echo "Please enter your MCP access tokens (comma-separated):"
    read -s MCP_TOKENS
    echo -n "$MCP_TOKENS" | gcloud secrets create mcp-access-tokens --data-file=-
    echo -e "${GREEN}✅ Secret created successfully${NC}"
else
    echo -e "${GREEN}✅ Secret already exists${NC}"
    echo -e "${YELLOW}⚠️  To update the secret, run:${NC}"
    echo "echo 'your-new-tokens' | gcloud secrets versions add mcp-access-tokens --data-file=-"
fi

# Update cloud-run.yaml with correct project ID
sed "s/PROJECT_ID/$PROJECT_ID/g" cloud-run.yaml > cloud-run-deploy.yaml

# Deploy to Cloud Run
echo -e "${GREEN}🚀 Deploying to Cloud Run...${NC}"
gcloud run services replace cloud-run-deploy.yaml \
    --region=$REGION \
    --platform=managed

# Make service publicly accessible
echo -e "${GREEN}🌐 Making service publicly accessible...${NC}"
gcloud run services add-iam-policy-binding $SERVICE_NAME \
    --region=$REGION \
    --member="allUsers" \
    --role="roles/run.invoker"

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

echo ""
echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${GREEN}📍 Service URL: $SERVICE_URL${NC}"
echo ""
echo -e "${YELLOW}Test your deployment:${NC}"
echo "curl -H 'Authorization: Bearer YOUR_TOKEN' $SERVICE_URL/health"
echo ""
echo -e "${YELLOW}Available endpoints:${NC}"
echo "  GET  $SERVICE_URL/health"
echo "  POST $SERVICE_URL/mcp"
echo "  POST $SERVICE_URL/api/tools/list"
echo "  POST $SERVICE_URL/api/tools/call"
echo "  POST $SERVICE_URL/api/airbnb/search"
echo "  POST $SERVICE_URL/api/airbnb/listing/:id"
echo ""
echo -e "${YELLOW}Don't forget to:${NC}"
echo "1. Save your access tokens securely"
echo "2. Test the API endpoints"
echo "3. Monitor the service logs: gcloud run services logs tail $SERVICE_NAME --region=$REGION"

# Clean up temporary file
rm -f cloud-run-deploy.yaml