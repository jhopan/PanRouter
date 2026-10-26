export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Install the process-level safety net FIRST: a dropped client socket
    // (Node's `abortIncoming`) otherwise kills the whole server, and the CLI
    // restarts it and prints the stderr tail as a "crash log".
    const { installProcessGuards } = await import("@/lib/processGuards");
    installProcessGuards();

    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();
  }
}
