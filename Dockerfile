FROM oven/bun:1

RUN mkdir /app
WORKDIR /app

COPY ./package.json /app/package.json
RUN bun install

COPY ./.env /app/.env
COPY ./src /app/src

CMD ["bun", "/app/src/index.ts"]
