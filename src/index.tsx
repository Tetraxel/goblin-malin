import React from "react";
import { type Instance, render } from "ink";
import process from "node:process";
import { App } from "./components/App";
import { FullScreenBox } from "./components/FullScreenBox";
import { globalLogger } from "./base/logger/logger";

async function write(content: string) {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(content, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function cleanUpOnExit(instance: Instance) {
  await instance.waitUntilExit();
  await write("\x1b[?1049l");
}

type WithFullScreen = (...args: Parameters<typeof render>) => {
  instance: Instance;
  start: () => Promise<void>;
  waitUntilExit: () => Promise<void>;
};

export const withFullScreen: WithFullScreen = (node, options) => {
  const instance = render(null, options);
  const exitPromise = cleanUpOnExit(instance);
  function waitUntilExit() {
    return exitPromise;
  }

  return {
    instance: instance,
    start: async () => {
      instance.rerender(<FullScreenBox>{node}</FullScreenBox>);
    },
    waitUntilExit,
  };
};

export function start(): void {
  console.log = (...args: any[]) => globalLogger.info(args.join(" "));
  console.error = (...args: any[]) => globalLogger.error(args.join(" "));
  console.warn = (...args: any[]) => globalLogger.warn(args.join(" "));

  process.on("unhandledRejection", (reason, promise) => {
    globalLogger.error("Unhandled Rejection", { promise, reason });
  });

  try {
    if (process.stdin && (process.stdin as any).isTTY) {
      process.stdin.setEncoding("utf8");
      process.stdin.resume();
    }
  } catch {
    /* ignore if stdin manipulation fails */
  }

  process.stdout.rows = process.stdout.rows;
  process.stdout.columns = process.stdout.columns;

  render(<App />, { patchConsole: true, maxFps: 60, exitOnCtrlC: false });
}

const GoblinMalin = { start };
export default GoblinMalin;
