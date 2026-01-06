# Gunakan Node.js versi LTS
FROM node:18-alpine

# Set working directory di dalam container
WORKDIR /app

# Copy package.json dan package-lock.json
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --only=production

# Copy seluruh source code backend
COPY . .

# Expose port yang digunakan aplikasi
EXPOSE 3000

# Command untuk menjalankan aplikasi
CMD ["npm", "start"]
