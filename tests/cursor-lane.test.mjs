import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const shim = process.env.CURSOR_LANE_UNDER_TEST || path.join(root, "lanes/omnigent-cursor-lane");
const hermesShim = path.join(root, "lanes/omnigent-hermes-lane");
const systemPath = process.env.PATH || "";
const realGit = execFileSync("/usr/bin/which", ["git"], { encoding: "utf8" }).trim();

function git(args, cwd) {
  return execFileSync(realGit, args, { cwd, encoding: "utf8" }).trim();
}

function initializeRepository(worktree, remote, branch) {
  mkdirSync(worktree);
  git(["init", "-q", "-b", "main"], worktree);
  git(["config", "user.name", "Cursor Lane Test"], worktree);
  git(["config", "user.email", "cursor-lane@example.invalid"], worktree);
  writeFileSync(path.join(worktree, "seed.txt"), "seed\n");
  git(["add", "seed.txt"], worktree);
  git(["commit", "-q", "-m", "seed"], worktree);
  git(["init", "-q", "--bare", remote], worktree);
  git(["remote", "add", "origin", remote], worktree);
  git(["push", "-q", "origin", "main"], worktree);
  git(["switch", "-q", "-c", branch], worktree);
  writeFileSync(path.join(worktree, "feature.txt"), "feature\n");
  git(["add", "feature.txt"], worktree);
  git(["commit", "-q", "-m", "feature"], worktree);
  const featureSha = git(["rev-parse", "HEAD"], worktree);
  git(["branch", "-f", "main", featureSha], worktree);
  git(["push", "-q", "origin", `HEAD:refs/heads/${branch}`], worktree);
  return featureSha;
}

function makeFixture() {
  const allowedRoot = path.join(homedir(), "worktrees");
  mkdirSync(allowedRoot, { recursive: true });
  const directory = mkdtempSync(path.join(allowedRoot, "cursor-lane-test-"));
  const worktree = path.join(directory, "repo");
  const remote = path.join(directory, "remote.git");
  const otherRepo = path.join(directory, "other-repo");
  const otherRemote = path.join(directory, "other-remote.git");
  const bin = path.join(directory, "bin");
  const parentGhConfig = path.join(directory, "parent-gh-config");
  mkdirSync(bin);
  mkdirSync(parentGhConfig);
  writeFileSync(path.join(parentGhConfig, "hosts.yml"), "github.com:\n  user: test\n");
  const featureSha = initializeRepository(worktree, remote, "test/cursor-lane");
  initializeRepository(otherRepo, otherRemote, "test/other");

  const cursorAgent = path.join(bin, "cursor-agent");
  writeFileSync(cursorAgent, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "status") {
  if (process.env.FAKE_STATUS_OUTPUT !== undefined) console.log(process.env.FAKE_STATUS_OUTPUT);
  else console.log("Logged in as cursor-lane-test");
  process.exit(Number(process.env.FAKE_STATUS_EXIT || 0));
}
if (args[0] === "whoami") {
  if (process.env.FAKE_WHOAMI_OUTPUT !== undefined) console.log(process.env.FAKE_WHOAMI_OUTPUT);
  process.exit(Number(process.env.FAKE_WHOAMI_EXIT || 1));
}
if (args[0] === "models") {
  if (process.env.FAKE_MODELS_OUTPUT !== undefined) console.log(process.env.FAKE_MODELS_OUTPUT);
  else console.log("Available models");
  process.exit(Number(process.env.FAKE_MODELS_EXIT || 0));
}
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ cwd: process.cwd(), args, agentCliCredentialStore: process.env.AGENT_CLI_CREDENTIAL_STORE }) + "\\n");
if (!process.env.FAKE_NO_INIT) {
  console.log(JSON.stringify({ type: "system", subtype: "init", model: process.env.FAKE_MODEL || "Composer 2.5" }));
  if (process.env.FAKE_SECOND_MODEL) console.log(JSON.stringify({ type: "system", subtype: "init", model: process.env.FAKE_SECOND_MODEL }));
}
let operationExit = null;
switch (process.env.FAKE_BYPASS || "") {
  case "plus-main": operationExit = spawnSync("git", ["push", "origin", "+main"], { stdio: "ignore" }).status; break;
  case "plus-main-ref": operationExit = spawnSync("git", ["push", "origin", "+refs/heads/main"], { stdio: "ignore" }).status; break;
  case "no-verify": operationExit = spawnSync("git", ["push", "--no-verify", "origin", "HEAD:refs/heads/test/cursor-lane"], { stdio: "ignore" }).status; break;
  case "short-no-verify": operationExit = spawnSync("git", ["push", "-n", "origin", "HEAD:refs/heads/test/cursor-lane"], { stdio: "ignore" }).status; break;
  case "switch-main": {
    operationExit = spawnSync("git", ["switch", "main"], { stdio: "ignore" }).status;
    if (operationExit === 0) operationExit = spawnSync("git", ["push", "origin", "HEAD"], { stdio: "ignore" }).status;
    break;
  }
  case "branch-main": {
    operationExit = spawnSync("git", ["branch", "-M", "main"], { stdio: "ignore" }).status;
    if (operationExit === 0) operationExit = spawnSync("git", ["push", "origin", "HEAD"], { stdio: "ignore" }).status;
    break;
  }
  case "config-push": operationExit = spawnSync("git", ["-c", "remote.origin.push=refs/heads/main", "push", "origin"], { stdio: "ignore" }).status; break;
  case "other-repo": operationExit = spawnSync("git", ["-C", process.env.FAKE_OTHER_REPO, "push", "origin", "HEAD:main"], { stdio: "ignore" }).status; break;
  case "absolute-git": operationExit = spawnSync(process.env.FAKE_REAL_GIT, ["push", "origin", "HEAD:main"], { stdio: "ignore" }).status; break;
  case "bang-alias": {
    spawnSync(process.env.FAKE_REAL_GIT, ["config", "alias.lane-bypass", "!" + process.env.FAKE_REAL_GIT + " push origin HEAD:main"], { stdio: "ignore" });
    operationExit = spawnSync("git", ["lane-bypass"], { stdio: "ignore" }).status;
    break;
  }
  case "gh-api": operationExit = spawnSync("gh", ["api", "-X", "PUT", "repos/o/r/pulls/1/merge"], { stdio: "ignore" }).status; break;
  case "gh-repo-merge": operationExit = spawnSync("gh", ["-R", "o/r", "pr", "merge", "1"], { stdio: "ignore" }).status; break;
  case "gh-absolute-auth": operationExit = spawnSync(process.env.FAKE_GH_BIN, ["api", "user"], { stdio: "ignore" }).status; break;
  case "move-remote-main": operationExit = spawnSync(process.env.FAKE_REAL_GIT, ["--git-dir", process.env.FAKE_REMOTE, "update-ref", "refs/heads/main", process.env.FAKE_FEATURE_SHA], { stdio: "ignore" }).status; break;
}
const result = operationExit === null ? (process.env.FAKE_RESULT || "implemented") : (process.env.FAKE_BYPASS + "_exit=" + operationExit);
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result }));
process.exit(Number(process.env.FAKE_RUN_EXIT || 0));
`);
  chmodSync(cursorAgent, 0o755);

  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!/usr/bin/env node
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";
const configFile = path.join(process.env.GH_CONFIG_DIR || "", "hosts.yml");
const authenticated = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || existsSync(configFile));
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ authenticated, configDir: process.env.GH_CONFIG_DIR || "" }) + "\\n");
process.exit(authenticated ? 0 : 4);
`);
  chmodSync(gh, 0o755);

  return {
    bin,
    directory,
    featureSha,
    gh,
    ghLog: path.join(directory, "gh.log"),
    log: path.join(directory, "cursor.log"),
    otherRemote,
    otherRepo,
    parentGhConfig,
    remote,
    worktree,
  };
}

function run(fixture, args, extraEnv = {}) {
  return spawnSync(process.execPath, [shim, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.bin}${path.delimiter}${systemPath}`,
      FAKE_FEATURE_SHA: fixture.featureSha,
      FAKE_GH_BIN: fixture.gh,
      FAKE_GH_LOG: fixture.ghLog,
      FAKE_LOG: fixture.log,
      FAKE_OTHER_REPO: fixture.otherRepo,
      FAKE_REAL_GIT: realGit,
      FAKE_REMOTE: fixture.remote,
      GH_CONFIG_DIR: fixture.parentGhConfig,
      GH_TOKEN: "test-token-never-print",
      GITHUB_TOKEN: "test-token-never-print",
      OMNIGENT_CURSOR_LANE_DISABLE_API_KEY_VAULT: "1",
      CURSOR_API_KEY: "",
      CURSOR_AUTH_TOKEN: "",
      ...extraEnv,
    },
  });
}

function runTask(fixture, extraEnv = {}) {
  return run(fixture, ["--worktree", fixture.worktree, "--prompt", "make the requested change", "--model", "composer-2.5"], extraEnv);
}

function parsed(stdout) {
  return JSON.parse(stdout.trim());
}

function remoteMain(fixture, remote = fixture.remote) {
  const check = spawnSync(realGit, ["--git-dir", remote, "rev-parse", "--verify", "refs/heads/main"], { encoding: "utf8" });
  return check.status === 0 ? check.stdout.trim() : null;
}

test("captures only the first init identity and runs inside the worktree", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
  const execution = runTask(fixture, { FAKE_SECOND_MODEL: "Unexpected Second Model" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(parsed(execution.stdout), {
    status: "completed",
    executed_models: ["Composer 2.5"],
    final_text: "implemented",
    exit: 0,
  });
  const invocation = JSON.parse(readFileSync(fixture.log, "utf8").trim());
  assert.equal(invocation.cwd, fixture.worktree);
  assert.deepEqual(invocation.args.slice(0, 6), ["-p", "--trust", "--model", "composer-2.5", "--output-format", "stream-json"]);
  const extension = spawnSync(realGit, ["config", "--local", "--get", "extensions.worktreeConfig"], { cwd: fixture.worktree, encoding: "utf8" });
  assert.equal(extension.status, 1);
  assert.deepEqual(readdirSync(fixture.worktree).filter((name) => name.startsWith(".omnigent-cursor-hooks-")), []);
});

test("fails closed for missing identity and preserves a nonzero cursor exit", async (t) => {
  await t.test("missing init identity", (st) => {
    const fixture = makeFixture();
    st.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
    const execution = runTask(fixture, { FAKE_NO_INIT: "1" });
    assert.notEqual(execution.status, 0);
    const output = parsed(execution.stdout);
    assert.equal(output.status, "failed");
    assert.deepEqual(output.executed_models, ["UNKNOWN"]);
  });
  await t.test("cursor-agent nonzero", (st) => {
    const fixture = makeFixture();
    st.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
    const execution = runTask(fixture, { FAKE_RUN_EXIT: "7" });
    assert.equal(execution.status, 7);
    assert.equal(parsed(execution.stdout).exit, 7);
  });
});

test("refuses a symlink escape from an allowed root", (t) => {
  const fixture = makeFixture();
  const outside = mkdtempSync(path.join(tmpdir(), "cursor-lane-outside-"));
  const link = path.join(fixture.directory, "escaped-repo");
  git(["init", "-q", "-b", "test/outside"], outside);
  symlinkSync(outside, link);
  t.after(() => {
    rmSync(fixture.directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const execution = run(fixture, ["--worktree", link, "--prompt", "do something", "--model", "composer-2.5"]);
  assert.equal(execution.status, 2);
  assert.match(parsed(execution.stdout).error, /must resolve beneath/);
});

test("sets AGENT_CLI_CREDENTIAL_STORE=memory for child cursor-agent by default", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
  const execution = runTask(fixture);
  assert.equal(execution.status, 0, execution.stderr);
  const invocation = JSON.parse(readFileSync(fixture.log, "utf8").trim());
  assert.equal(invocation.agentCliCredentialStore, "memory");
});

test("preserves explicit AGENT_CLI_CREDENTIAL_STORE for child cursor-agent", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
  const execution = runTask(fixture, { AGENT_CLI_CREDENTIAL_STORE: "keychain" });
  assert.equal(execution.status, 0, execution.stderr);
  const invocation = JSON.parse(readFileSync(fixture.log, "utf8").trim());
  assert.equal(invocation.agentCliCredentialStore, "keychain");
});

test("preserves empty AGENT_CLI_CREDENTIAL_STORE without defaulting to memory", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
  const execution = runTask(fixture, { AGENT_CLI_CREDENTIAL_STORE: "" });
  assert.equal(execution.status, 0, execution.stderr);
  const invocation = JSON.parse(readFileSync(fixture.log, "utf8").trim());
  assert.equal(invocation.agentCliCredentialStore, "");
});

test("readiness parses an authenticated result instead of trusting exit zero", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
  const ready = run(fixture, ["--readiness"], { FAKE_STATUS_OUTPUT: "Logged in as test-user", FAKE_STATUS_EXIT: "0" });
  assert.equal(ready.status, 0);
  const misleadingZero = run(fixture, ["--readiness"], { FAKE_STATUS_OUTPUT: "Not logged in", FAKE_STATUS_EXIT: "0", FAKE_WHOAMI_EXIT: "1" });
  assert.equal(misleadingZero.status, 1);
  const whoami = run(fixture, ["--readiness"], { FAKE_STATUS_EXIT: "1", FAKE_WHOAMI_EXIT: "0", FAKE_WHOAMI_OUTPUT: "test-user" });
  assert.equal(whoami.status, 0);
  const emptySuccess = run(fixture, ["--readiness"], { FAKE_STATUS_OUTPUT: "", FAKE_STATUS_EXIT: "0", FAKE_WHOAMI_EXIT: "0", FAKE_WHOAMI_OUTPUT: "" });
  assert.equal(emptySuccess.status, 1);
});

test("readiness validates API-key auth via cursor-agent models", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
  const keyEnv = { CURSOR_API_KEY: "test-key-never-print" };
  const apiKeyReady = run(fixture, ["--readiness"], {
    ...keyEnv,
    FAKE_STATUS_OUTPUT: "Not logged in",
    FAKE_STATUS_EXIT: "0",
    FAKE_MODELS_OUTPUT: "Available models",
    FAKE_MODELS_EXIT: "0",
  });
  assert.equal(apiKeyReady.status, 0);
  assert.equal(parsed(apiKeyReady.stdout).ready, true);
  const invalidKey = run(fixture, ["--readiness"], {
    ...keyEnv,
    FAKE_MODELS_OUTPUT: "Warning: The provided API key is invalid",
    FAKE_MODELS_EXIT: "0",
  });
  assert.equal(invalidKey.status, 1);
  assert.equal(parsed(invalidKey.stdout).ready, false);
  const noKeyNotLoggedIn = run(fixture, ["--readiness"], {
    FAKE_STATUS_OUTPUT: "Not logged in",
    FAKE_STATUS_EXIT: "0",
    FAKE_WHOAMI_EXIT: "1",
  });
  assert.equal(noKeyNotLoggedIn.status, 1);
  assert.equal(parsed(noKeyNotLoggedIn.stdout).ready, false);
});

test("repo hook and argv guard reject every reviewed git bypass", async (t) => {
  const cases = [
    ["git push origin +main", "plus-main"],
    ["git push origin +refs/heads/main", "plus-main-ref"],
    ["git push --no-verify", "no-verify"],
    ["git push -n", "short-no-verify"],
    ["git switch main then push HEAD", "switch-main"],
    ["git branch -M main then push HEAD", "branch-main"],
    ["git -c remote.origin.push=refs/heads/main push origin", "config-push"],
    ["git -C other-repo push", "other-repo"],
    ["absolute git push", "absolute-git"],
    ["bang alias absolute git push", "bang-alias"],
  ];
  for (const [name, bypass] of cases) {
    await t.test(name, (st) => {
      const fixture = makeFixture();
      st.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
      const before = remoteMain(fixture);
      const otherBefore = remoteMain(fixture, fixture.otherRemote);
      const execution = runTask(fixture, { FAKE_BYPASS: bypass });
      assert.equal(execution.status, 0, execution.stderr);
      assert.match(parsed(execution.stdout).final_text, /_exit=(?!0$)\d+$/);
      assert.equal(remoteMain(fixture), before);
      assert.equal(remoteMain(fixture, fixture.otherRemote), otherBefore);
    });
  }
});

test("gh merge forms are blocked and ambient authentication is stripped", async (t) => {
  for (const bypass of ["gh-api", "gh-repo-merge"]) {
    await t.test(bypass, (st) => {
      const fixture = makeFixture();
      st.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
      const execution = runTask(fixture, { FAKE_BYPASS: bypass });
      assert.equal(execution.status, 0, execution.stderr);
      assert.match(parsed(execution.stdout).final_text, /_exit=64$/);
    });
  }
  await t.test("absolute gh sees no auth", (st) => {
    const fixture = makeFixture();
    st.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
    const execution = runTask(fixture, { FAKE_BYPASS: "gh-absolute-auth" });
    assert.equal(execution.status, 0, execution.stderr);
    assert.match(parsed(execution.stdout).final_text, /_exit=4$/);
    const ghObservation = JSON.parse(readFileSync(fixture.ghLog, "utf8").trim());
    assert.equal(ghObservation.authenticated, false);
    assert.notEqual(ghObservation.configDir, fixture.parentGhConfig);
  });
});

test("reports integrity_violation when remote main moves during the run", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
  const execution = runTask(fixture, { FAKE_BYPASS: "move-remote-main" });
  assert.equal(execution.status, 70);
  const output = parsed(execution.stdout);
  assert.equal(output.status, "integrity_violation");
  assert.deepEqual(output.executed_models, ["Composer 2.5"]);
  assert.match(output.error, /protected remote branch moved/);
});

test("Hermes transport hands marked tasks to the cursor shim", (t) => {
  const fixture = makeFixture();
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
  const task = `CURSOR_CLI_LANE_TASK\nWORKTREE: ${fixture.worktree}\nPROMPT:\nimplement it`;
  const execution = spawnSync(hermesShim, ["chat", "-q", task, "-Q", "--source", "tool", "-m", "composer-2.5"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.bin}${path.delimiter}${systemPath}`,
      FAKE_FEATURE_SHA: fixture.featureSha,
      FAKE_GH_BIN: fixture.gh,
      FAKE_LOG: fixture.log,
      FAKE_OTHER_REPO: fixture.otherRepo,
      FAKE_REAL_GIT: realGit,
      FAKE_REMOTE: fixture.remote,
      OMNIGENT_CURSOR_LANE_BIN: shim,
    },
  });
  assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(parsed(execution.stdout).executed_models, ["Composer 2.5"]);
});
