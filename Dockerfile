# Use official Node.js LTS (Node 20 slim)
FROM node:20-slim

# Create and define the application directory
WORKDIR /usr/src/app

# Install production dependencies
COPY package*.json ./
COPY shim/ ./shim/

RUN npm install --omit=dev

# Copy application source code
COPY . .

# Cloud Run defaults to 8080
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["npm", "start"]
