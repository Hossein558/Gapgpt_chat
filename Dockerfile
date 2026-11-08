# Lightweight Alpine Node image (< 100MB)
FROM node:20-alpine

WORKDIR /app

# Copy application files
COPY package.json gap_chat.mjs gapgpt_mcp.mjs http_server.mjs ./

# Default environment variables
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

# Default: Run HTTP / OpenAI-compatible microservice
# (To run as MCP server instead, override command with: node gapgpt_mcp.mjs)
CMD ["node", "http_server.mjs"]
