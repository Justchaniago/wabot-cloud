FROM node:20-slim

# Create application directory
WORKDIR /usr/src/app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy source code
COPY . .

# Build Web Control Panel Frontend
RUN cd panel && npm install && npm run build

# Cloud Run listens on PORT env (default 8080)
EXPOSE 8080

# Start command
CMD ["npm", "start"]
