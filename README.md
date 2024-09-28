# Expense manager

A simple Telegram bot that helps you manage your expenses.

# Installation

Create a `.env` file with the following content:

```
BOT_TOKEN=YOUR_BOT_TOKEN
```

Create an empty `db.sqlite` file.

```bash
touch db.sqlite
```

Run `docker-compose up` to start the bot in a container.

Run `bun src/index.ts` to start the bot in the current terminal.
