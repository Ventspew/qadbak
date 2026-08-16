const fs = require("fs");
const path = require("path");

/** Load .env.local so pm2 always has QADBAK_LEGACY_API_* (Next.js also reads it, but pm2 env must match). */
function loadEnvFile(filePath) {
  const root = path.join(__dirname);
  const env = {
    NODE_ENV: "production",
    PORT: "3000",
    QADBAK_TERMINAL_WS_PORT: "3001",
    QADBAK_TERMINAL_WS_HOST: "127.0.0.1",
    NODE_PATH: path.join(root, "node_modules"),
  };
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = loadEnvFile(path.join(__dirname, ".env.local"));

module.exports = {
  apps: [
    {
      name: "qadbak",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start",
      env,
    },
    {
      name: "qadbak-terminal",
      cwd: __dirname,
      script: "scripts/domain-terminal-ws.mjs",
      interpreter: "node",
      env,
    },
    {
      name: "qadbak-node-agent",
      cwd: __dirname,
      script: "scripts/qadbak-node-agent.mjs",
      interpreter: "node",
      env,
    },
    {
      name: "qadbak-discord-notify",
      cwd: __dirname,
      script: "scripts/qadbak-discord-notify.mjs",
      interpreter: "node",
      env,
    },
  ],
};
