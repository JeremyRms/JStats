import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEFAULT_SECRET_FILES = {
  API_KEY: path.join(os.homedir(), ".jstats", "github_api_key"),
  JIRA_API_TOKEN: path.join(os.homedir(), ".jira", "api_token"),
};

export function loadSecretEnvValues(env = process.env) {
  for (const [name, defaultPath] of Object.entries(DEFAULT_SECRET_FILES)) {
    const filePath =
      name === "API_KEY"
        ? env.GITHUB_API_KEY_FILE || defaultPath
        : env[`${name}_FILE`] || defaultPath;
    const secret = readSecretFile(filePath);
    if (secret) {
      env[name] = secret;
    }
  }

  return env;
}

function readSecretFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const secret = fs.readFileSync(filePath, "utf8").trim();
    return secret || null;
  } catch (error) {
    console.warn(`Unable to read secret file ${filePath}: ${error.message}`);
    return null;
  }
}
