import { app } from "electron";
import { handleSquirrelStartup } from "./squirrel-startup.js";

if (handleSquirrelStartup()) {
  app.quit();
} else {
  await import("./main.js");
}
