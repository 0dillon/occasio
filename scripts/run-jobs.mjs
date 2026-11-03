// Production entry for background work: starts the restricted fetcher and the
// worker in one container (the fetcher only listens on 127.0.0.1, so they
// must share a host). If either exits, the other is stopped and the process
// exits non-zero so the platform restarts both.
import { spawn } from "node:child_process";

const procs = [
  ["fetcher", ["tsx", "fetcher/server.ts"]],
  ["worker", ["tsx", "worker/index.ts"]],
].map(([name, args]) => {
  const p = spawn("npx", args, { stdio: "inherit", env: process.env });
  p.on("exit", (code) => {
    console.error(`[jobs] ${name} exited with ${code}; stopping`);
    for (const q of procs) if (q !== p && q.exitCode === null) q.kill("SIGTERM");
    process.exit(code || 1);
  });
  return p;
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
