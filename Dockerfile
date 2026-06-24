# Use a lightweight Node.js 20 image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package management files
COPY package*.json ./

# Install dependencies (including devDependencies required for bundling)
RUN npm ci

# Copy the entire codebase
COPY . .

# Build Vite client-side code and bundle server.ts with esbuild
RUN npm run build

# Ensure the downloads directory exists and has full write permissions
RUN mkdir -p /app/downloads && chmod -R 777 /app/downloads

# Expose port 7860 (Hugging Face Spaces default container port)
EXPOSE 7860

# Define production environment variables
ENV NODE_ENV=production
ENV PORT=7860

# Start the Node.js application
CMD ["npm", "start"]
