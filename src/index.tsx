import React from "react";
import { type Instance, render } from "ink";
import process from "node:process";
import { App } from "./components/App";
import { FullScreenBox } from "./components/FullScreenBox";
import { globalLogger } from "./base/logger/logger";

const ENTER_ALT_SCREEN_COMMAND = "\x1b[?1049h";
const LEAVE_ALT_SCREEN_COMMAND = "\x1b[?1049l";

// Override console.log
console.log = (...args: any[]) => {
  globalLogger.info(args.join(" "));
};

// Optional: Do the same for other console methods
console.error = (...args: any[]) => {
  globalLogger.error(args.join(" "));
};

console.warn = (...args: any[]) => {
  globalLogger.warn(args.join(" "));
};

process.on("unhandledRejection", (reason, promise) => {
  globalLogger.error("Unhandled Rejection", { promise, reason });
  // Don't exit the process, just log it
});

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
  await write("\x1b[?1049l"); // exit alternate buffer
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
      // await write(ENTER_ALT_SCREEN_COMMAND); // enter alternate buffer
      instance.rerender(<FullScreenBox>{node}</FullScreenBox>);
    },
    waitUntilExit,
  };
};

// try {
//   if (typeof process.stdout.getWindowSize === "function") {
//     const [columns, rows] = process.stdout.getWindowSize();
//     process.stdout.rows = rows || process.stdout.rows || 24;
//     process.stdout.columns = columns || process.stdout.columns || 80;
//   } else {
//     process.stdout.rows = process.stdout.rows || 24;
//     process.stdout.columns = process.stdout.columns || 80;
//   }
// } catch {
//   process.stdout.rows = process.stdout.rows || 24;
//   process.stdout.columns = process.stdout.columns || 80;
// }

///////////////////////////////////////////////////////

// prevent CTRL+C from closing the terminal
try {
  if (process.stdin && (process.stdin as any).isTTY) {
    process.stdin.setEncoding("utf8");
    // resume in case stdin is paused
    process.stdin.resume();

    // process.stdin.on("data", (chunk: string | Buffer) => {
    //   // handle both string and Buffer cases
    //   const isCtrlC =
    //     (typeof chunk === "string" && chunk.includes("\x03")) ||
    //     (Buffer.isBuffer(chunk) && chunk.includes(3));
    //   if (isCtrlC) {
    //     // process.stdout.write("\u001b[3J\u001b[1J");
    //     // console.clear();
    //     // process.stdout.write(LEAVE_ALT_SCREEN_COMMAND);
    //     // process.stdout.write(ENTER_ALT_SCREEN_COMMAND);
    //     // process.stdout.write(LEAVE_ALT_SCREEN_COMMAND);
    //     // console.info("Saving cache before exit…");
    //     // cache.save();
    //     // process.exit(0);
    //   }
    // });
  }
} catch {
  /* ignore if stdin manipulation fails */
}

process.stdout.rows = process.stdout.rows; // - 1;
process.stdout.columns = process.stdout.columns; // - 1;
const options = {
  patchConsole: true,
  maxFps: 60,
  exitOnCtrlC: false,
};

// withFullScreen(<App />, options).start();
render(<App />, options);
