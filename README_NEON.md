Neon DB integration
-------------------

This project includes a small optional server to persist generated answers into a Neon Postgres database.

How to run (locally):

- Create a `.env` file (excluded from git) with:
  - `NEON_API` set to your Neon connection string (the one you added earlier)

- Install dependencies and run the server:

  ```bash
  npm install express body-parser pg
  NEON_API="your-connection-string" node server.js
  ```

The front-end will POST to `/saveAnswer` when the "Save answers to Neon DB" toggle is enabled in Settings. The server will store answers in a table called `answers`.
