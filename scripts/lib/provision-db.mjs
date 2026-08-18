import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emit, fail, resolveDomainUser } from "./provisioning-common.mjs";
import { assertCountCap } from "./domain-limits-cap.mjs";

const exec = promisify(execFile);

function sqlQuote(id) {
  return `\`${String(id).replace(/`/g, "")}\``;
}

async function mysqlExec(sql) {
  const args = ["-N", "-B", "-e", sql];
  try {
    const { stdout } = await exec("mysql", args, { maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (err.includes("Access denied")) {
      fail("MySQL root access required for native databases (configure root .my.cnf on server)");
    }
    throw e;
  }
}

async function postgresExec(sql) {
  try {
    const { stdout } = await exec(
      "sudo",
      ["-u", "postgres", "psql", "-t", "-A", "-c", sql],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (err.includes("command not found") || err.includes("No such file")) {
      fail("PostgreSQL not installed (apt install postgresql)");
    }
    throw e;
  }
}

function pgIdent(id) {
  return `"${String(id).replace(/"/g, "")}"`;
}

/** List/create/password all use unixUser_name (MySQL used to create unprefixed DBs that then vanished from the UI). */
function mysqlCanonicalName(user, name) {
  const cleaned = String(name || "").replace(/[^a-zA-Z0-9_]/g, "");
  if (!cleaned) fail("Database name required.");
  const userNorm = String(user).replace(/-/g, "_");
  const prefix = `${userNorm}_`;
  if (cleaned === userNorm || cleaned.startsWith(prefix)) return cleaned.slice(0, 64);
  return `${prefix}${cleaned}`.slice(0, 64);
}

export async function dbList(domain) {
  const { user } = await resolveDomainUser(domain);
  const prefix = `${user}_`;
  const out = await mysqlExec("SHOW DATABASES");
  const databases = out
    .split("\n")
    .filter((name) => name.startsWith(prefix) || name === user.replace(/-/g, "_"))
    .map((name) => ({ name, type: "mysql", host: "localhost" }));
  try {
    const pgOut = await postgresExec(
      `SELECT datname FROM pg_database WHERE datname LIKE '${prefix.replace(/'/g, "''")}%'`,
    );
    for (const name of pgOut.split("\n").filter(Boolean)) {
      databases.push({ name, type: "postgres", host: "localhost" });
    }
  } catch {
    /* postgres optional */
  }
  emit({ ok: true, databases });
}

export async function dbCreate(domain, name, pass, typeArg) {
  const { user } = await resolveDomainUser(domain);
  const prefix = `${user}_`;
  let count = 0;
  try {
    const out = await mysqlExec("SHOW DATABASES");
    count += out
      .split("\n")
      .filter((n) => n.startsWith(prefix) || n === user.replace(/-/g, "_")).length;
  } catch {
    /* */
  }
  await assertCountCap(domain, "databases", count);
  const dbType = String(typeArg || "mysql").toLowerCase();
  if (dbType === "postgres" || dbType === "postgresql") {
    const dbName = `${user}_${name}`.slice(0, 63).replace(/-/g, "_");
    const dbUser = dbName;
    const safePass = pass.replace(/'/g, "''");
    await postgresExec(`CREATE USER ${pgIdent(dbUser)} WITH PASSWORD '${safePass}'`).catch(() => {});
    await postgresExec(`CREATE DATABASE ${pgIdent(dbName)} OWNER ${pgIdent(dbUser)}`).catch(async () => {
      await postgresExec(`CREATE DATABASE ${pgIdent(dbName)}`);
      await postgresExec(`GRANT ALL PRIVILEGES ON DATABASE ${pgIdent(dbName)} TO ${pgIdent(dbUser)}`);
    });
    emit({ ok: true, name: dbName, user: dbUser, type: "postgres" });
    return;
  }
  const canonical = mysqlCanonicalName(user, name);
  const dbName = sqlQuote(canonical);
  const dbUser = sqlQuote(canonical.slice(0, 32));
  await mysqlExec(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
  await mysqlExec(
    `CREATE USER IF NOT EXISTS ${dbUser}@'localhost' IDENTIFIED BY '${pass.replace(/'/g, "''")}'`,
  );
  await mysqlExec(`GRANT ALL PRIVILEGES ON ${dbName}.* TO ${dbUser}@'localhost'`);
  await mysqlExec("FLUSH PRIVILEGES");
  emit({ ok: true, name: canonical, user: canonical.slice(0, 32), type: "mysql" });
}

export async function dbPass(domain, name, pass, typeArg) {
  const dbType = String(typeArg || "mysql").toLowerCase();
  if (dbType === "postgres" || dbType === "postgresql") {
    const { user } = await resolveDomainUser(domain);
    const dbUser = `${user}_${name}`.slice(0, 63).replace(/-/g, "_");
    await postgresExec(
      `ALTER USER ${pgIdent(dbUser)} WITH PASSWORD '${pass.replace(/'/g, "''")}'`,
    );
    emit({ ok: true, type: "postgres" });
    return;
  }
  const { user } = await resolveDomainUser(domain);
  const dbUser = sqlQuote(mysqlCanonicalName(user, name).slice(0, 32));
  await mysqlExec(
    `ALTER USER ${dbUser}@'localhost' IDENTIFIED BY '${pass.replace(/'/g, "''")}'`,
  );
  await mysqlExec("FLUSH PRIVILEGES");
  emit({ ok: true, type: "mysql" });
}
