FROM node:18-alpine
WORKDIR /app

# Check if package.json exists, if so install dependencies
# Otherwise just rely on standard library as per original repo
RUN if [ -f package.json ]; then npm install; fi

COPY . .

EXPOSE 8383

CMD ["node", "index.js"]
