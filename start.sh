#!/bin/bash

echo "============================================"
echo "  AI Radiology Report Generator"
echo "  Starting Application..."
echo "============================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Kill processes on ports 3000 and 3001
echo -e "${YELLOW}Cleaning up used ports...${NC}"
for PORT in 3000 3001; do
  PID=$(lsof -ti:$PORT 2>/dev/null)
  if [ -n "$PID" ]; then
    echo -e "${RED}Killing process on port $PORT (PID: $PID)${NC}"
    kill -9 $PID 2>/dev/null
    sleep 1
  fi
done
echo -e "${GREEN}Ports cleared.${NC}"

# Check PostgreSQL
echo -e "${BLUE}Checking PostgreSQL...${NC}"
if ! pg_isready -q 2>/dev/null; then
  echo -e "${RED}PostgreSQL is not running. Please start it first.${NC}"
  exit 1
fi
echo -e "${GREEN}PostgreSQL is running.${NC}"

# Install root dependencies
echo -e "${BLUE}Installing server dependencies...${NC}"
npm install --silent 2>&1 | tail -1

# Install client dependencies
echo -e "${BLUE}Installing client dependencies...${NC}"
cd client && npm install --silent 2>&1 | tail -1
cd "$PROJECT_DIR"

# Setup database
echo -e "${BLUE}Setting up database...${NC}"
node server/setupDb.js

# Wait for DB to be ready
sleep 1

# Seed data
echo -e "${BLUE}Seeding database with sample data...${NC}"
node server/seed.js

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Database seeded successfully!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}Starting servers with hot reload...${NC}"
echo -e "${YELLOW}  Backend:  http://localhost:3001${NC}"
echo -e "${YELLOW}  Frontend: http://localhost:3000${NC}"
echo ""
echo -e "${GREEN}Login Credentials:${NC}"
echo -e "  Email:    admin@radiology.com"
echo -e "  Password: password123"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all servers${NC}"
echo ""

# Start with hot reload using concurrently (nodemon for backend, react-scripts for frontend)
npx concurrently \
  --names "SERVER,CLIENT" \
  --prefix-colors "blue,green" \
  "npx nodemon --watch server server/index.js" \
  "cd client && BROWSER=none PORT=3000 npm start"
